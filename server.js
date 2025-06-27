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

// Import our tracker modules
const { ProgressTracker, LeetCodeAPI, EmailService } = require('./tracker');
const { StudyPlanHelper } = require('./study-plan');

// Import helper functions from tracker.js
// We need to extract these into a separate module or re-implement here
const fs = require('fs');

const PROGRESS_PATH = path.join(__dirname, 'progress.json');
const SETTINGS_PATH = path.join(__dirname, 'settings.json');

// Default structures (copied from tracker.js)
const DEFAULT_SETTINGS = {
  num_questions: 1,
  email_enabled: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

const DEFAULT_PROGRESS = {
  lastSentDate: null,
  sentProblems: [],
  studyPlanPosition: 0,
  pendingQueue: [],
  settingsAtSendTime: {
    num_questions: 1,
    timestamp: null
  }
};

// Helper functions
function loadSettings() {
  try {
    const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    return { ...DEFAULT_SETTINGS, ...data };
  } catch (e) {
    saveSettings(DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings) {
  const updatedSettings = {
    ...settings,
    updated_at: new Date().toISOString()
  };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(updatedSettings, null, 2));
  return updatedSettings;
}

function loadProgress() {
  try {
    const data = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf-8'));
    return { ...DEFAULT_PROGRESS, ...data };
  } catch (e) {
    return DEFAULT_PROGRESS;
  }
}

function validateNumQuestions(num) {
  const parsed = parseInt(num);
  if (isNaN(parsed) || parsed < 1) return 1;
  if (parsed > 10) return 10;
  return parsed;
}

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// Create tracker instance
const tracker = new ProgressTracker();

// API Routes

// Get current settings
app.get('/api/settings', (req, res) => {
  try {
    const settings = loadSettings();
    res.json(settings);
  } catch (error) {
    console.error('Error loading settings:', error);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

// Update settings
app.post('/api/settings', (req, res) => {
  try {
    const { num_questions } = req.body;
    
    if (typeof num_questions !== 'number') {
      return res.status(400).json({ error: 'num_questions must be a number' });
    }
    
    const validatedNum = validateNumQuestions(num_questions);
    const currentSettings = loadSettings();
    
    const updatedSettings = saveSettings({
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
app.get('/api/progress', (req, res) => {
  try {
    const progress = loadProgress();
    res.json(progress);
  } catch (error) {
    console.error('Error loading progress:', error);
    res.status(500).json({ error: 'Failed to load progress' });
  }
});

// Get comprehensive status
app.get('/api/status', (req, res) => {
  try {
    const settings = loadSettings();
    const progress = loadProgress();
    const orderedProblems = StudyPlanHelper.getOrderedProblemList();
    
    // Get problem details for sent problems
    const problemDetails = {};
    progress.sentProblems.forEach(sentProblem => {
      const problem = StudyPlanHelper.getProblemBySlug(sentProblem.slug);
      if (problem) {
        problemDetails[sentProblem.slug] = problem;
      }
    });
    
    const status = {
      totalProblems: orderedProblems.length,
      problemDetails: problemDetails,
      currentTopic: orderedProblems[progress.studyPlanPosition]?.topicIndex || 0,
      completionPercentage: Math.round((progress.studyPlanPosition / orderedProblems.length) * 100)
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
    
    // Capture console output
    const originalLog = console.log;
    const originalError = console.error;
    let output = [];
    
    console.log = (...args) => {
      output.push(args.join(' '));
      originalLog(...args);
    };
    
    console.error = (...args) => {
      output.push(`ERROR: ${args.join(' ')}`);
      originalError(...args);
    };
    
    try {
      await tracker.testTracker();
      
      // Restore console
      console.log = originalLog;
      console.error = originalError;
      
      res.json({
        success: true,
        message: 'Test completed successfully',
        output: output.slice(-10) // Last 10 lines
      });
      
    } catch (testError) {
      // Restore console
      console.log = originalLog;
      console.error = originalError;
      
      res.json({
        success: false,
        message: testError.message,
        output: output.slice(-10)
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
    
    // Capture console output
    const originalLog = console.log;
    const originalError = console.error;
    let output = [];
    
    console.log = (...args) => {
      output.push(args.join(' '));
      originalLog(...args);
    };
    
    console.error = (...args) => {
      output.push(`ERROR: ${args.join(' ')}`);
      originalError(...args);
    };
    
    try {
      await tracker.runDailyRoutine();
      
      // Restore console
      console.log = originalLog;
      console.error = originalError;
      
      res.json({
        success: true,
        message: 'Daily check completed successfully',
        output: output.slice(-10)
      });
      
    } catch (checkError) {
      // Restore console
      console.log = originalLog;
      console.error = originalError;
      
      res.json({
        success: false,
        message: checkError.message,
        output: output.slice(-10)
      });
    }
    
  } catch (error) {
    console.error('Error running daily check:', error);
    res.status(500).json({ error: 'Failed to run daily check' });
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
    version: '2.0.0-multi-problem',
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Keep alive endpoint for Render.com
app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

// Auto-start cron jobs in production
if (process.env.NODE_ENV === 'production') {
  console.log('🔄 Starting background cron jobs for production...');
  const tracker = new ProgressTracker();
  tracker.startScheduledJobs();
  
  // Keep service alive by pinging itself every 14 minutes
  if (process.env.RENDER_EXTERNAL_URL) {
    setInterval(async () => {
      try {
        const response = await fetch(`${process.env.RENDER_EXTERNAL_URL}/ping`);
        console.log('🏓 Keep-alive ping:', response.status);
      } catch (error) {
        console.log('🏓 Keep-alive ping failed:', error.message);
      }
    }, 14 * 60 * 1000); // 14 minutes
  }
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