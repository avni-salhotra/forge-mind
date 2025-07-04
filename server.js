#!/usr/bin/env node

/**
 * LeetCode Tracker Web Server
 * 
 * Provides:
 * 1. Web interface for settings management
 * 2. API endpoints for frontend communication
 * 3. Integration with existing tracker functionality
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');

// Import our tracker modules
const { ProgressTracker, LeetCodeAPI, EmailService } = require('./tracker');
const { StudyPlanHelper } = require('./study-plan');

// Import version from package.json
const { version } = require('./package.json');

// Import Firebase database service
const { databaseService, DEFAULT_SETTINGS, DEFAULT_PROGRESS } = require('./lib/firebase');

// Import system design email sender
const { sendSystemDesignEmail } = require('./send-system-design');

// Utility functions
function validateNumQuestions(num) {
  const parsed = parseInt(num);
  if (isNaN(parsed) || parsed < 1) return 1;
  if (parsed > 10) return 10;
  return parsed;
}

function safeCompare(a, b) {
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

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

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
    console.error('Error loading settings:', error);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

// Update settings
app.post('/api/settings', async (req, res) => {
  try {
    const { num_questions } = req.body;
    
    if (typeof num_questions !== 'number') {
      return res.status(400).json({ error: 'num_questions must be a number' });
    }
    
    const validatedNum = validateNumQuestions(num_questions);
    const currentSettings = await databaseService.loadSettings();
    
    const updatedSettings = await databaseService.saveSettings({
      ...currentSettings,
      num_questions: validatedNum
    });
    
    console.log(`⚙️ Settings updated: ${validatedNum} problems per day`);
    
    res.json({
      success: true,
      settings: updatedSettings,
      message: `Updated to ${validatedNum} problems per day`
    });
    
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Get current progress
app.get('/api/progress', async (req, res) => {
  try {
    const progress = await databaseService.loadProgress();
    res.json(progress);
  } catch (error) {
    console.error('Error loading progress:', error);
    res.status(500).json({ error: 'Failed to load progress' });
  }
});

// Get comprehensive status
app.get('/api/status', async (req, res) => {
  try {
    const settings = await databaseService.loadSettings();
    const progress = await databaseService.loadProgress();
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
      progressState: inBounds ? 'in_progress' : 'completed'
    };
    
    res.json(status);
  } catch (error) {
    console.error('Error getting status:', error);
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
    console.error('Error running test:', error);
    res.status(500).json({ error: 'Failed to run test' });
  }
});

// Run daily check
app.post('/api/check', async (req, res) => {
  try {
    console.log('⚡ Running daily check via API...');
    
    const capture = captureConsole();
    
    try {
      await tracker.runDailyRoutine();
      capture.restore();
      
      res.json({
        success: true,
        message: 'Daily check completed successfully',
        output: capture.importantOutput.slice(-3) // Only return last 3 important messages
      });
      
    } catch (checkError) {
      capture.restore();
      
      res.json({
        success: false,
        message: checkError.message,
        output: capture.importantOutput.slice(-3) // Only return last 3 important messages on error
      });
    }
    
  } catch (error) {
    console.error('Error running daily check:', error);
    res.status(500).json({ error: 'Failed to run daily check' });
  }
});

// Daily routine endpoint (for GitHub Actions trigger)
app.post('/api/daily-routine', async (req, res) => {
  try {
    console.log('🤖 Daily routine triggered by GitHub Actions...');
    
    const startTime = Date.now();
    
    const capture = captureConsole();
    
    try {
      await tracker.runDailyRoutine();
      capture.restore();
      
      const duration = Date.now() - startTime;
      
      res.json({
        success: true,
        message: 'Daily routine completed successfully',
        timestamp: new Date().toISOString(),
        duration: `${duration}ms`,
        triggered_by: 'github_actions',
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
        triggered_by: 'github_actions',
        output: capture.output.slice(-15)
      });
    }
    
  } catch (error) {
    console.error('Error running daily routine:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to run daily routine',
      timestamp: new Date().toISOString(),
      triggered_by: 'github_actions'
    });
  }
});

// System Design Routes (kept separate from LeetCode routes)
app.post('/api/system-design/send', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;
    
    // Timing-safe comparison to prevent auth bypass
    if (!authHeader || !safeCompare(authHeader, expectedAuth)) {
      console.log('❌ Unauthorized attempt to send system design email');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('📚 Sending system design email...');
    
    await sendSystemDesignEmail();
    
    res.json({
      success: true,
      message: 'System design email sent successfully'
    });
    
  } catch (error) {
    console.error('Error sending system design email:', error);
    res.status(500).json({ 
      error: 'Failed to send system design email',
      details: error.message 
    });
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: version,
    uptime: process.uptime(),
    memoryMB: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)
  });
});

// Auto-start cron jobs in production
if (process.env.NODE_ENV === 'production') {
  console.log('🔄 Starting background cron jobs for production...');
  tracker.startScheduledJobs();
}

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`
🚀 LeetCode Tracker Web Server Started!

📱 Frontend: http://localhost:${PORT}
🔧 API Base: http://localhost:${PORT}/api
💊 Health Check: http://localhost:${PORT}/health

✨ Features:
  - Multi-problem daily delivery
  - Web-based settings management
  - Real-time status monitoring
  - Manual trigger capabilities

🎯 Ready to enhance your LeetCode journey!
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

module.exports = app;