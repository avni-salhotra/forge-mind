#!/usr/bin/env node

/**
 * LeetCode Tracker Web Server
 * Last updated: July 4, 2025 - Fixed "already sent today" detection
 * 
 * Provides:
 * 1. Web interface for settings management
 * 2. API endpoints for frontend communication
 * 3. Integration with existing tracker functionality
 * 4. Enhanced security with rate limiting and authentication
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');

// Import security and configuration services
const { SecurityService, ConfigValidator } = require('./lib/security');

// Import our tracker modules
const { ProgressTracker, LeetCodeAPI, EmailService } = require('./tracker');
const { StudyPlanHelper } = require('./study-plan');

// Import version from package.json
const { version } = require('./package.json');

// Import Firebase database service (enhanced with transactions)
const { databaseService, DEFAULT_SETTINGS, DEFAULT_PROGRESS, createCheckpoint, rollbackToCheckpoint } = require('./lib/firebase');

// Import system design email sender
const { sendSystemDesignEmail } = require('./send-system-design');

// Initialize security service
let securityService;
try {
  // Validate configuration on startup
  ConfigValidator.validateAndSanitize();
  securityService = new SecurityService();
  console.log('🛡️ Security service initialized successfully');
} catch (error) {
  console.error('❌ Failed to initialize security service:', error.message);
  process.exit(1);
}

// Enhanced utility functions
function validateNumQuestions(num) {
  const parsed = parseInt(num);
  if (isNaN(parsed) || parsed < 1) return 1;
  if (parsed > 10) return 10;
  return parsed;
}

function safeCompare(a, b) {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);
}

function captureConsole() {
  const originalLog = console.log;
  const originalErr = console.error;
  const output = [];
  const importantOutput = [];

  console.log = (...args) => {
    const message = args.join(' ');
    output.push(message);
    
    // Filter important messages
    if (message.includes('✅') || 
        message.includes('❌') || 
        message.includes('📝') || 
        message.includes('🎉')) {
      importantOutput.push(message);
    }
    originalLog(...args);
  };
  
  console.error = (...args) => {
    const message = `ERROR: ${args.join(' ')}`;
    output.push(message);
    importantOutput.push(message);
    originalErr(...args);
  };

  return {
    output,
    importantOutput,
    restore: () => {
      console.log = originalLog;
      console.error = originalErr;
    }
  };
}

/**
 * Security middleware factory
 */
function createSecurityMiddleware(options = {}) {
  const { requireAuth = false, skipRateLimit = false } = options;
  
  return async (req, res, next) => {
    try {
      const clientIP = ConfigValidator.getClientIP(req);
      
      // Skip rate limiting for health checks and static files
      if (!skipRateLimit && !req.path.startsWith('/health') && !req.path.startsWith('/diagrams')) {
        try {
          securityService.checkRateLimit(clientIP);
        } catch (rateLimitError) {
          console.warn(`🚨 Rate limit exceeded for IP ${clientIP}: ${rateLimitError.message}`);
          return res.status(429).json({ 
            error: 'Rate limit exceeded',
            message: rateLimitError.message,
            retryAfter: Math.ceil(securityService.windowMs / 1000)
          });
        }
      }
      
      // Check authentication if required
      if (requireAuth) {
        const authHeader = req.headers.authorization || '';
        const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;
        
        if (!authHeader || !safeCompare(authHeader, expectedAuth)) {
          console.warn(`🚨 Unauthorized attempt from IP ${clientIP} to ${req.path}`);
          return res.status(401).json({ error: 'Unauthorized' });
        }
        
        // Record successful authentication
        securityService.recordSuccess(clientIP);
        console.log(`✅ Authorized request from IP ${clientIP} to ${req.path}`);
      }
      
      // Add security headers
      res.set({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Referrer-Policy': 'strict-origin-when-cross-origin'
      });
      
      next();
    } catch (error) {
      console.error('❌ Security middleware error:', error.message);
      res.status(500).json({ error: 'Security check failed' });
    }
  };
}

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for proper IP detection on Render
app.set('trust proxy', true);

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' })); // Limit payload size
app.use(express.static(path.join(__dirname, 'frontend')));

// Apply security middleware globally (with exceptions)
app.use(createSecurityMiddleware({ skipRateLimit: false }));

// Serve static files from diagrams directory
app.use('/diagrams', express.static(path.join(__dirname, 'diagrams')));

// Create tracker instance
const tracker = new ProgressTracker();

// API Routes

// Get current settings
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await databaseService.loadSettings();
    res.json(settings);
  } catch (error) {
    console.error('Error loading settings:', error.message);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

// Update settings (with atomic transaction)
app.post('/api/settings', async (req, res) => {
  let checkpoint;
  
  try {
    const { num_questions } = req.body;
    
    // Input validation
    if (typeof num_questions !== 'number') {
      return res.status(400).json({ error: 'num_questions must be a number' });
    }
    
    // Create checkpoint before making changes
    checkpoint = await createCheckpoint();
    
    const validatedNum = validateNumQuestions(num_questions);
    
    // Use atomic update
    const updatedSettings = await databaseService.atomicSettingsUpdate('default', (currentSettings) => ({
      ...currentSettings,
      num_questions: validatedNum
    }));
    
    console.log(`⚙️ Settings updated: ${validatedNum} problems per day`);
    
    res.json({
      success: true,
      settings: updatedSettings,
      message: `Updated to ${validatedNum} problems per day`
    });
    
  } catch (error) {
    console.error('Error updating settings:', error.message);
    
    // Rollback on failure
    if (checkpoint) {
      try {
        await rollbackToCheckpoint(checkpoint);
        console.log('🔄 Settings update rolled back successfully');
      } catch (rollbackError) {
        console.error('❌ Rollback failed:', rollbackError.message);
      }
    }
    
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Get current progress
app.get('/api/progress', async (req, res) => {
  try {
    const progress = await databaseService.loadProgress();
    res.json(progress);
  } catch (error) {
    console.error('Error loading progress:', error.message);
    res.status(500).json({ error: 'Failed to load progress' });
  }
});

// Get comprehensive status
app.get('/api/status', async (req, res) => {
  try {
    const [settings, progress] = await Promise.all([
      databaseService.loadSettings(),
      databaseService.loadProgress()
    ]);
    
    const orderedProblems = StudyPlanHelper.getOrderedProblemList();
    
    // Get problem details for sent problems
    const problemDetails = {};
    progress.sentProblems.forEach(sentProblem => {
      const problem = StudyPlanHelper.getProblemBySlug(sentProblem.slug);
      if (problem) {
        problemDetails[sentProblem.slug] = problem;
      }
    });
    
    const position = progress.studyPlanPosition;
    const inBounds = position >= 0 && position < orderedProblems.length;
    
    const status = {
      totalProblems: orderedProblems.length,
      problemDetails: problemDetails,
      currentTopic: inBounds ? orderedProblems[position].topicIndex : null,
      completionPercentage: orderedProblems.length > 0 ? Math.round((progress.studyPlanPosition / orderedProblems.length) * 100) : 0,
      progressState: inBounds ? 'in_progress' : 'completed',
      version: progress.version || 1,
      lastModified: progress.lastModified
    };
    
    res.json(status);
  } catch (error) {
    console.error('Error getting status:', error.message);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// Run tracker test
app.post('/api/test', async (req, res) => {
  try {
    console.log('🧪 Running tracker test via API...');
    
    const capture = captureConsole();
    
    try {
      await tracker.testTracker();
      capture.restore();
      
      res.json({
        success: true,
        message: 'Test completed successfully',
        output: capture.output.slice(-10) // Last 10 lines
      });
      
    } catch (testError) {
      capture.restore();
      
      res.json({
        success: false,
        message: testError.message,
        output: capture.output.slice(-10)
      });
    }
    
  } catch (error) {
    console.error('Error running test:', error.message);
    res.status(500).json({ error: 'Failed to run test' });
  }
});

// Run daily check (with rollback support) - COMPACT VERSION FOR CRON
app.post('/api/check', async (req, res) => {
  let checkpoint;
  const startTime = Date.now();
  
  try {
    console.log('⚡ Running daily check via API...');
    
    // FIRST: Check if problems were already sent today BEFORE creating checkpoint or waking API
    const progress = await databaseService.loadProgress();
    
    // Use consistent timezone for date comparison (PST/PDT - your local timezone)
    const now = new Date();
    const localDate = new Date(now.getTime() - (8 * 60 * 60 * 1000)); // PST is UTC-8
    const todayStr = localDate.toISOString().split('T')[0]; // yyyy-mm-dd format
    
    console.log(`📅 Date comparison: lastSent="${progress.lastSentDate}" vs today="${todayStr}"`);
    
    if (progress.lastSentDate === todayStr) {
      const duration = Date.now() - startTime;
      console.log('⏭️ Problems already sent today. Returning ALREADY_SENT status.');
      console.log(`📝 Today's problems: [${progress.sentProblems.map(p => p.slug).join(', ')}]`);
      
      // Return ALREADY_SENT immediately without API wake-up
      return res.json({
        status: 'ALREADY_SENT',
        message: 'Problems already sent today',
        duration: Math.round(duration / 1000) + 's',
        timestamp: todayStr,
        problems: progress.sentProblems.map(p => p.slug)
      });
    }
    
    // Create checkpoint before running routine
    checkpoint = await createCheckpoint();
    
    // Determine if this is from cron-job.org (check user agent or other indicators)
    const userAgent = req.headers['user-agent'] || '';
    const isCronJob = userAgent.includes('cron-job.org') || 
                     req.headers['x-forwarded-for'] ||
                     !req.headers.referer; // Likely automated if no referer
    
    let capture;
    if (isCronJob) {
      // Ultra-minimal logging for cron jobs but capture critical messages
      const originalLog = console.log;
      const originalError = console.error;
      let errorMessages = [];
      
      console.log = (...args) => {
        const message = args.join(' ');
        // Only show critical messages for cron
        if (message.includes('✅') || 
            message.includes('❌') || 
            message.includes('📝') || 
            message.includes('🎉')) {
          originalLog(...args);
        }
      };
      
      console.error = (...args) => {
        errorMessages.push(args.join(' '));
        originalError(...args); // Still log to server
      };
      
      try {
        await tracker.runDailyRoutineWithRollback();
        
        // Restore console
        console.log = originalLog;
        console.error = originalError;
        
        const duration = Date.now() - startTime;
        
        // Ultra-compact success response for cron
        res.json({
          status: 'OK',
          duration: Math.round(duration / 1000) + 's',
          timestamp: todayStr
        });
        
      } catch (routineError) {
        // Restore console
        console.log = originalLog;
        console.error = originalError;
        
        const duration = Date.now() - startTime;
        
        // Compact error response for cron
        let status = 'ERROR';
        if (routineError.message.includes('Circuit breaker')) status = 'CIRCUIT_BREAKER';
        else if (routineError.message.includes('timeout')) status = 'TIMEOUT';
        
        res.json({
          status,
          duration: Math.round(duration / 1000) + 's',
          error: routineError.message.slice(0, 80) + '...',
          timestamp: todayStr
        });
      }
    } else {
      // Full verbose output for web interface
      capture = captureConsole();
      
      try {
        await tracker.runDailyRoutineWithRollback();
        capture.restore();
        
        const duration = Date.now() - startTime;
        
        res.json({
          success: true,
          message: 'Daily check completed successfully',
          duration: `${duration}ms`,
          output: capture.importantOutput.slice(-3),
          coldStart: {
            duration,
            status: 'completed'
          }
        });
        
      } catch (routineError) {
        capture.restore();
        const duration = Date.now() - startTime;
        
        // Extract circuit breaker info if present
        const circuitBreakerActive = capture.output.some(msg => 
          msg.includes('Circuit breaker is active') || 
          msg.includes('Circuit breaker tripped')
        );

        // Check if it's a cold start issue
        const isColdStart = capture.output.some(msg => 
          msg.includes('API appears to be sleeping') || 
          msg.includes('starting wake-up process')
        );
        
        res.json({
          success: false,
          message: routineError.message,
          duration: `${duration}ms`,
          output: capture.importantOutput.slice(-3),
          coldStart: {
            inProgress: isColdStart,
            duration,
            circuitBreakerActive,
            status: circuitBreakerActive ? 'circuit_breaker' : 
                   isColdStart ? 'waking_up' : 'error'
          }
        });
      }
    }
    
  } catch (error) {
    console.error('Error running daily check:', error.message);
    
    // Rollback on failure
    if (checkpoint) {
      try {
        await rollbackToCheckpoint(checkpoint);
        console.log('🔄 Daily check rolled back successfully');
      } catch (rollbackError) {
        console.error('❌ Rollback failed:', rollbackError.message);
      }
    }
    
    const duration = Date.now() - startTime;
    const todayStr = new Date().toISOString().split('T')[0];
    
    // Return compact response for cron, detailed for web
    const userAgent = req.headers['user-agent'] || '';
    const isCronJob = userAgent.includes('cron-job.org') || 
                     req.headers['x-forwarded-for'] ||
                     !req.headers.referer;
    
    if (isCronJob) {
      res.status(500).json({ 
        status: 'CRITICAL_ERROR',
        duration: Math.round(duration / 1000) + 's',
        timestamp: todayStr
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: 'Failed to run daily check',
        message: error.message
      });
    }
  }
});

// Compact endpoint for cron-job.org (minimal output)
app.post('/api/cron-check', async (req, res) => {
  let checkpoint;
  const startTime = Date.now();
  
  try {
    console.log('🕐 Running compact cron check...');
    
    // Create checkpoint before running routine
    checkpoint = await createCheckpoint();
    
    // Silence console output for cron
    const originalLog = console.log;
    const originalError = console.error;
    let hasError = false;
    let errorMessage = '';
    
    console.log = () => {}; // Silence normal logging
    console.error = (...args) => {
      hasError = true;
      errorMessage = args.join(' ');
      originalError(...args); // Still log to server
    };
    
    try {
      await tracker.runDailyRoutineWithRollback();
      
      // Restore console
      console.log = originalLog;
      console.error = originalError;
      
      const duration = Date.now() - startTime;
      
      // Ultra-compact success response
      res.json({
        status: 'OK',
        duration: Math.round(duration / 1000) + 's',
        timestamp: new Date().toISOString().split('T')[0] // Just date
      });
      
    } catch (routineError) {
      // Restore console
      console.log = originalLog;
      console.error = originalError;
      
      const duration = Date.now() - startTime;
      
      // Check error type for compact response
      const isCircuitBreaker = routineError.message.includes('Circuit breaker');
      const isColdStart = routineError.message.includes('timeout') || 
                         routineError.message.includes('ECONNRESET');
      
      let status = 'ERROR';
      if (isCircuitBreaker) status = 'CIRCUIT_BREAKER';
      else if (isColdStart) status = 'COLD_START';
      
      res.json({
        status,
        duration: Math.round(duration / 1000) + 's',
        error: routineError.message.slice(0, 100) + '...', // Truncate error
        timestamp: new Date().toISOString().split('T')[0]
      });
    }
    
  } catch (error) {
    console.error('Critical cron check error:', error.message);
    
    // Rollback on failure
    if (checkpoint) {
      try {
        await rollbackToCheckpoint(checkpoint);
      } catch (rollbackError) {
        console.error('❌ Rollback failed:', rollbackError.message);
      }
    }
    
    const duration = Date.now() - startTime;
    
    res.status(500).json({ 
      status: 'CRITICAL_ERROR',
      duration: Math.round(duration / 1000) + 's',
      timestamp: new Date().toISOString().split('T')[0]
    });
  }
});

// Daily routine endpoint (for external cron triggers) - requires authentication
app.post('/api/daily-routine', createSecurityMiddleware({ requireAuth: true }), async (req, res) => {
  let checkpoint;
  
  try {
    console.log('🤖 Daily routine triggered by external cron...');
    
    // Create checkpoint before running routine
    checkpoint = await createCheckpoint();
    
    const startTime = Date.now();
    const capture = captureConsole();
    
    try {
      await tracker.runDailyRoutineWithRollback();
      capture.restore();
      
      const duration = Date.now() - startTime;
      
      res.json({
        success: true,
        message: 'Daily routine completed successfully',
        timestamp: new Date().toISOString(),
        duration: `${duration}ms`,
        triggered_by: 'external_cron',
        output: capture.output.slice(-15) // Last 15 lines for debugging
      });
      
    } catch (routineError) {
      capture.restore();
      
      const duration = Date.now() - startTime;
      
      res.status(500).json({
        success: false,
        message: routineError.message,
        timestamp: new Date().toISOString(),
        duration: `${duration}ms`,
        triggered_by: 'external_cron',
        output: capture.output.slice(-15)
      });
    }
    
  } catch (error) {
    console.error('Error running daily routine:', error.message);
    
    // Rollback on failure
    if (checkpoint) {
      try {
        await rollbackToCheckpoint(checkpoint);
        console.log('🔄 Daily routine rolled back successfully');
      } catch (rollbackError) {
        console.error('❌ Rollback failed:', rollbackError.message);
      }
    }
    
    res.status(500).json({ 
      success: false,
      error: 'Failed to run daily routine',
      timestamp: new Date().toISOString(),
      triggered_by: 'external_cron'
    });
  }
});

// System Design Routes - requires authentication
app.post('/api/system-design/send', createSecurityMiddleware({ requireAuth: true }), async (req, res) => {
  try {
    console.log('📚 Sending system design email...');
    
    await sendSystemDesignEmail();
    
    res.json({
      success: true,
      message: 'System design email sent successfully'
    });
    
  } catch (error) {
    console.error('Error sending system design email:', error.message);
    res.status(500).json({ 
      error: 'Failed to send system design email',
      details: error.message 
    });
  }
});

// Security status endpoint (for monitoring)
app.get('/api/security/status', (req, res) => {
  const clientIP = ConfigValidator.getClientIP(req);
  const status = securityService.getStatus(clientIP);
  
  res.json({
    ip: clientIP,
    rateLimitStatus: status,
    timestamp: new Date().toISOString()
  });
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Enhanced health check
app.get('/health', createSecurityMiddleware({ skipRateLimit: true }), async (req, res) => {
  try {
    // Quick database connection test
    const dbHealthy = await databaseService.testConnection();
    
    const health = {
      status: dbHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      version: version,
      uptime: process.uptime(),
      memoryMB: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
      database: dbHealthy ? 'connected' : 'disconnected',
      security: 'active'
    };
    
    res.status(dbHealthy ? 200 : 503).json(health);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Auto-start cron jobs in production
if (process.env.NODE_ENV === 'production') {
  console.log('🔄 Starting background cron jobs for production...');
  tracker.startScheduledJobs();
}

// Enhanced error handling middleware
app.use((error, req, res, next) => {
  const clientIP = ConfigValidator.getClientIP(req);
  console.error(`❌ Server error from IP ${clientIP}:`, error.message);
  
  // Don't expose internal error details in production
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message;
  
  res.status(500).json({ error: message });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Graceful shutdown with cleanup
function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
  
  // Cleanup security service
  if (securityService) {
    securityService.destroy();
  }
  
  process.exit(0);
}

// Start server
app.listen(PORT, () => {
  console.log(`
🚀 LeetCode Tracker Web Server Started!

📱 Frontend: http://localhost:${PORT}
🔧 API Base: http://localhost:${PORT}/api
💊 Health Check: http://localhost:${PORT}/health
🛡️ Security: Rate limiting and authentication active

✨ Features:
  - Multi-problem daily delivery
  - Web-based settings management
  - Real-time status monitoring
  - Manual trigger capabilities
  - Atomic transactions with rollback
  - Enhanced security and rate limiting

🎯 Ready to enhance your LeetCode journey!
  `);
});

// Graceful shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;