#!/usr/bin/env node

/**
 * LeetCode Progress Tracker
 * 
 * Main application that:
 * 1. Checks daily LeetCode progress against study plan
 * 2. Sends email notifications based on progress
 * 3. Tracks streaks and overall progress
 * 4. Runs scheduled checks via cron jobs
 * 5. Supports multiple problems per day with frontend configuration
 */

require('dotenv').config();
const axios = require('axios');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const { format, startOfDay, isToday, parseISO } = require('date-fns');

const { STUDY_PLAN, TRACKER_CONFIG, StudyPlanHelper } = require('./study-plan');

// Import Firebase database service
const { databaseService } = require('./lib/firebase');

// Import our new Phase 3-4 components
const { DateUtils } = require('./lib/dateUtils');
const { DataValidator, ValidationError } = require('./lib/dataValidator');
const { MigrationService } = require('./lib/migrationService');

/**
 * New Data Structure Management
 */

// Default user settings
const DEFAULT_SETTINGS = {
  num_questions: 1,
  email_enabled: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

// Default progress structure
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

/**
 * Migration function for old progress.json format
 */
function migrateOldProgress(oldData) {
  console.log('📦 Old format detected:', oldData);
  
  const orderedProblems = StudyPlanHelper.getOrderedProblemList();
  let studyPlanPosition = 0;
  
  // Find current position in study plan
  if (oldData.lastSlug) {
    const currentIndex = orderedProblems.findIndex(p => p.slug === oldData.lastSlug);
    studyPlanPosition = currentIndex !== -1 ? currentIndex : 0;
  }
  
  const migratedProgress = {
    lastSentDate: oldData.lastSentDate,
    sentProblems: oldData.lastSlug ? [{
      slug: oldData.lastSlug,
      solved: oldData.solved || false,
      sentDate: oldData.lastSentDate
    }] : [],
    studyPlanPosition: studyPlanPosition,
    pendingQueue: [],
    settingsAtSendTime: {
      num_questions: 1, // Default for migrated data
      timestamp: oldData.lastSentDate
    }
  };
  
  console.log('✅ Migrated to new format:', migratedProgress);
  databaseService.saveProgress(migratedProgress);
  return migratedProgress;
}

/**
 * Helper function to validate and sanitize num_questions
 */
function validateNumQuestions(num) {
  const parsed = parseInt(num);
  if (isNaN(parsed) || parsed < 1) return 1;
  if (parsed > 10) return 10; // Maximum reasonable daily limit
  return parsed;
}

/**
 * Get problems to send today based on progress and settings
 */
function calculateTodaysProblems(progress, settings) {
  const numQuestions = validateNumQuestions(settings.num_questions);
  const orderedProblems = StudyPlanHelper.getOrderedProblemList();
  
  // Get unfinished problems from any previous day
  const unfinishedProblems = progress.sentProblems
    .filter(p => !p.solved)
    .map(p => p.slug);
  
  // Handle pending queue (from previous num_questions decreases)
  const allPending = [...unfinishedProblems, ...progress.pendingQueue];
  
  const result = {
    problems: [],
    unfinished: [],
    newProblems: [],
    updatedPosition: progress.studyPlanPosition,
    updatedPendingQueue: []
  };
  
  // If we have pending problems
  if (allPending.length > 0) {
    if (allPending.length >= numQuestions) {
      // More pending than we can send - prioritize oldest unsolved first
      const sortedPending = [...allPending];
      const oldestFirst = progress.sentProblems
        .filter(p => !p.solved)
        .sort((a, b) => new Date(a.sentDate) - new Date(b.sentDate))
        .map(p => p.slug);
      
      // Put oldest unsolved problems first
      oldestFirst.forEach(slug => {
        const idx = sortedPending.indexOf(slug);
        if (idx !== -1) {
          sortedPending.splice(idx, 1);
          sortedPending.unshift(slug);
        }
      });
      
      result.problems = sortedPending.slice(0, numQuestions);
      result.unfinished = result.problems;
      result.updatedPendingQueue = sortedPending.slice(numQuestions);
    } else {
      // Some pending + some new
      result.unfinished = [...allPending];
      result.problems = [...allPending];
      
      // Add new problems to fill quota
      const newNeeded = numQuestions - allPending.length;
      for (let i = 0; i < newNeeded && result.updatedPosition < orderedProblems.length; i++) {
        const nextProblem = orderedProblems[result.updatedPosition];
        result.problems.push(nextProblem.slug);
        result.newProblems.push(nextProblem.slug);
        result.updatedPosition++;
      }
      
      result.updatedPendingQueue = [];
    }
  } else {
    // No pending, all new problems
    for (let i = 0; i < numQuestions && result.updatedPosition < orderedProblems.length; i++) {
      const nextProblem = orderedProblems[result.updatedPosition];
      result.problems.push(nextProblem.slug);
      result.newProblems.push(nextProblem.slug);
      result.updatedPosition++;
    }
  }
  
  return result;
}

/**
 * LeetCode API Client
 */
class LeetCodeAPI {
  constructor() {
    this.baseURL = TRACKER_CONFIG.api.baseUrl;
    this.timeout = TRACKER_CONFIG.api.timeout;
    this.maxRetryAttempts = 12; // Allow for up to 10 minutes of retry
    this.initialRetryDelay = 30000; // Start with 30s delay
    this.maxRetryDelay = 120000; // Cap at 2 minutes per attempt
    this.circuitBreakerFailureCount = 0;
    this.circuitBreakerResetTimeout = 600000; // 10 minutes
    this.lastCircuitBreakerTrip = null;
  }

  /**
   * Get user's recent submissions with retry logic
   */
  async getUserSubmissions(username, limit = 20) {
    const maxRetries = 3;
    const baseTimeout = 15000; // Start with 15 seconds
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const timeout = baseTimeout * attempt; // Exponential timeout increase
        console.log(`🔄 API attempt ${attempt}/${maxRetries} (timeout: ${timeout}ms)`);
        
        const response = await axios.get(
          `${this.baseURL}/${username}/acSubmission?limit=${limit}`,
          { timeout }
        );
        
        console.log(`✅ API call successful on attempt ${attempt}`);
        return response.data;
        
      } catch (error) {
        console.log(`⚠️ API attempt ${attempt} failed: ${error.message}`);
        
        if (attempt === maxRetries) {
          console.error('❌ All API attempts failed - using fallback behavior');
          // Return empty but valid structure to prevent crashes
          return {
            count: 0,
            submission: []
          };
        }
        
        // Wait before retry (with exponential backoff)
        const waitTime = 2000 * attempt;
        console.log(`⏳ Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  /**
   * Get user profile data with retry logic
   */
  async getUserProfile(username) {
    const maxRetries = 3;
    const baseTimeout = 15000;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const timeout = baseTimeout * attempt;
        console.log(`🔄 Profile API attempt ${attempt}/${maxRetries} (timeout: ${timeout}ms)`);
        
        const response = await axios.get(
          `${this.baseURL}/${username}`,
          { timeout }
        );
        
        console.log(`✅ Profile API successful on attempt ${attempt}`);
        return response.data;
        
      } catch (error) {
        console.log(`⚠️ Profile API attempt ${attempt} failed: ${error.message}`);
        
        if (attempt === maxRetries) {
          console.error('❌ Profile API failed - continuing with limited functionality');
          throw error;
        }
        
        const waitTime = 2000 * attempt;
        console.log(`⏳ Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  /**
   * Get all submissions with pagination
   */
  async getAllSubmissions(username, startDate) {
    console.log(`\n🔄 Fetching ALL submissions since ${startDate}...`);
    let allSubmissions = [];
    let offset = 0;
    const limit = 100; // Maximum allowed by API
    let hasMore = true;

    while (hasMore) {
      try {
        console.log(`\n📑 Fetching page ${offset/limit + 1} (offset: ${offset}, limit: ${limit})`);
        const response = await axios.get(
          `${this.baseURL}/${username}/acSubmission?offset=${offset}&limit=${limit}`,
          { timeout: this.timeout }
        );

        const submissions = response.data.submission || [];
        console.log(`✅ Retrieved ${submissions.length} submissions`);

        if (submissions.length > 0) {
          // Log first and last submission timestamps in this batch
          const first = new Date(parseInt(submissions[0].timestamp) * 1000);
          const last = new Date(parseInt(submissions[submissions.length - 1].timestamp) * 1000);
          console.log(`   Range: ${first.toISOString()} -> ${last.toISOString()}`);

          // Check if we've gone past our start date
          const oldestTimestamp = parseInt(submissions[submissions.length - 1].timestamp) * 1000;
          const startTimestamp = new Date(startDate).getTime();
          if (oldestTimestamp < startTimestamp) {
            console.log(`🎯 Reached submissions older than target date, stopping pagination`);
            hasMore = false;
          }
        }

        allSubmissions = allSubmissions.concat(submissions);
        
        // If we got fewer results than limit, we've reached the end
        if (submissions.length < limit) {
          console.log(`📌 Reached end of submissions (got ${submissions.length} < ${limit})`);
          hasMore = false;
        } else {
          offset += limit;
          // Add a small delay between requests
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`❌ Error fetching submissions page:`, error.message);
        hasMore = false; // Stop on error
      }
    }

    console.log(`\n📊 Total submissions fetched: ${allSubmissions.length}`);
    return {
      count: allSubmissions.length,
      submission: allSubmissions
    };
  }

  /**
   * Get submissions for a specific date
   */
  async getSubmissionsForDate(username, targetDate) {
    try {
      // Try to get submissions with date parameter
      console.log(`\n🔍 Fetching submissions for ${targetDate}...`);
      const response = await axios.get(
        `${this.baseURL}/${username}/acSubmission?date=${targetDate}&limit=100`,
        { timeout: this.timeout }
      );

      if (!response.data.submission || !Array.isArray(response.data.submission)) {
        console.log('⚠️ Invalid API response structure');
        return [];
      }

      console.log(`\n📊 Found ${response.data.submission.length} submissions:`);
      response.data.submission.forEach(s => {
        const timestamp = new Date(parseInt(s.timestamp) * 1000);
        console.log(`\n${s.titleSlug}:`);
        console.log(`  Status: ${s.statusDisplay}`);
        console.log(`  UTC: ${timestamp.toISOString()}`);
        console.log(`  Local: ${timestamp.toLocaleString()}`);
      });

      // Filter accepted submissions
      const acceptedSubmissions = response.data.submission.filter(s => 
        (s.statusDisplay || '').toLowerCase() === 'accepted'
      );

      if (acceptedSubmissions.length > 0) {
        console.log(`\n✅ Found ${acceptedSubmissions.length} accepted submissions:`);
        acceptedSubmissions.forEach(s => {
          const timestamp = new Date(parseInt(s.timestamp) * 1000);
          console.log(`\n${s.titleSlug}:`);
          console.log(`  Status: ${s.statusDisplay}`);
          console.log(`  UTC: ${timestamp.toISOString()}`);
          console.log(`  Local: ${timestamp.toLocaleString()}`);
        });
      } else {
        console.log('\n❌ No accepted submissions found');
      }

      return acceptedSubmissions;
    } catch (error) {
      console.error('❌ Error:', error.message);
      return [];
    }
  }

  /**
   * Wake up the API (useful for cold starts on Render/Heroku)
   */
  async wakeUpAPI() {
    console.log('🌅 Starting API wake-up process...');
    let lastError = null;

    for (let attempt = 1; attempt <= this.maxRetryAttempts; attempt++) {
      // Check circuit breaker
      if (this.isCircuitBreakerTripped()) {
        console.log('🔌 Circuit breaker activated - stopping wake-up attempts');
        return false;
      }

      try {
        // Calculate delay with exponential backoff (capped)
        const delay = Math.min(
          this.initialRetryDelay * Math.pow(1.5, attempt - 1),
          this.maxRetryDelay
        );

        console.log(`\n🔄 Wake-up attempt ${attempt}/${this.maxRetryAttempts}`);
        console.log(`⏳ Timeout set to ${delay/1000}s`);
        
        const response = await axios.get(`${this.baseURL}/daily`, { timeout: delay });
        
        console.log('✅ API is awake and responsive!');
        this.circuitBreakerFailureCount = 0; // Reset on success
        return true;

      } catch (error) {
        lastError = error;
        console.log(`⚠️ Attempt ${attempt} failed: ${error.message}`);
        
        if (attempt < this.maxRetryAttempts) {
          const waitTime = Math.min(
            this.initialRetryDelay * Math.pow(1.5, attempt - 1),
            this.maxRetryDelay
          );
          
          console.log(`⏳ Waiting ${waitTime/1000}s before next attempt...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    // If we get here, all attempts failed
    this.incrementCircuitBreakerCount();
    console.log('❌ API wake-up failed after all attempts');
    console.log('💡 Circuit breaker may activate to prevent further attempts');
    return false;
  }

  /**
   * Check API health
   */
  async checkAPIHealth() {
    try {
      // Check if circuit breaker is tripped
      if (this.isCircuitBreakerTripped()) {
        console.log('🔌 Circuit breaker is active - preventing API calls');
        return { healthy: false, error: 'Circuit breaker active', circuitBreaker: true };
      }

      const start = Date.now();
      // Increased initial health check timeout
      const response = await axios.get(`${this.baseURL}/daily`, { timeout: 30000 });
      const duration = Date.now() - start;
      
      // Reset circuit breaker on success
      this.circuitBreakerFailureCount = 0;
      
      console.log(`✅ API Health: OK (${duration}ms response time)`);
      return { healthy: true, responseTime: duration };
    } catch (error) {
      console.log(`❌ API Health: POOR (${error.message})`);
      this.incrementCircuitBreakerCount();
      return { healthy: false, error: error.message };
    }
  }

  isCircuitBreakerTripped() {
    // Reset circuit breaker after timeout
    if (this.lastCircuitBreakerTrip && 
        Date.now() - this.lastCircuitBreakerTrip >= this.circuitBreakerResetTimeout) {
      console.log('🔌 Circuit breaker reset after timeout');
      this.circuitBreakerFailureCount = 0;
      this.lastCircuitBreakerTrip = null;
      return false;
    }

    return this.circuitBreakerFailureCount >= 5;
  }

  incrementCircuitBreakerCount() {
    this.circuitBreakerFailureCount++;
    if (this.circuitBreakerFailureCount >= 5 && !this.lastCircuitBreakerTrip) {
      this.lastCircuitBreakerTrip = Date.now();
      console.log('🔌 Circuit breaker tripped - will prevent API calls for 10 minutes');
    }
  }
}

/**
 * Email Notification Service
 */
class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
  }

  /**
   * Send email notification
   */
  async sendEmail(subject, htmlContent, textContent) {
    try {
      const mailOptions = {
        from: process.env.FROM_EMAIL,
        to: process.env.TO_EMAIL,
        subject: subject,
        html: htmlContent,
        text: textContent
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('✅ Email sent successfully:', subject);
      return result;
    } catch (error) {
      console.error('❌ Error sending email:', error.message);
      throw error;
    }
  }

  /**
   * Send new question notification
   */
  async sendNewQuestionEmail(weekNumber, weekTheme, problems) {
    const subject = `🚀 Week ${weekNumber} LeetCode Challenge: ${weekTheme}`;
    
    const htmlContent = `
      <h2>🎯 New Week Challenge!</h2>
      <p>Hey there! Ready for <strong>Week ${weekNumber}: ${weekTheme}</strong>?</p>
      
      <h3>📚 This Week's Problems:</h3>
      <ul>
        ${problems.map(p => `
          <li>
            <strong>${p.name}</strong> (${p.difficulty})
            <br/>⏱️ Estimated time: ${p.estimatedTime} minutes
            <br/>🔗 <a href="https://leetcode.com/problems/${p.slug}/">Solve on LeetCode</a>
          </li>
        `).join('')}
      </ul>
      
      <p>💪 <strong>Goal:</strong> Complete at least ${TRACKER_CONFIG.goals.dailyMinimum} problem today!</p>
      <p>🎯 <strong>Week Target:</strong> ${TRACKER_CONFIG.goals.weeklyTarget} problems</p>
      
      <p>Good luck! 🍀</p>
    `;

    const textContent = `
      Week ${weekNumber} LeetCode Challenge: ${weekTheme}
      
      This week's problems:
      ${problems.map(p => `- ${p.name} (${p.difficulty}) - ${p.estimatedTime} min`).join('\n')}
      
      Goal: Complete at least ${TRACKER_CONFIG.goals.dailyMinimum} problem today!
      Week Target: ${TRACKER_CONFIG.goals.weeklyTarget} problems
    `;

    await this.sendEmail(subject, htmlContent, textContent);
  }

  /**
   * Send reminder notification
   */
  async sendReminderEmail(problem, topicName){
    const subject = `⏰ Reminder – Yesterday's problem still pending`;
    const html = `
      <h2>⏰ Don't forget your LeetCode!</h2>
      <p>You didn't submit <strong>${problem.name}</strong> yesterday.</p>
      <p>Topic: ${topicName}</p>
      <p>🔗 <a href="https://leetcode.com/problems/${problem.slug}/">Try the problem now</a></p>`;
    const text = `Reminder – You still need to solve yesterday's problem:\n${problem.name}\nhttps://leetcode.com/problems/${problem.slug}/`;
    await this.sendEmail(subject,html,text);
  }

  /**
   * Send congratulations notification
   */
  async sendCongratulationsEmail(todaysProblems, streak = 0) {
    const subject = `🎉 Great job! ${todaysProblems.length} problem${todaysProblems.length > 1 ? 's' : ''} solved today!`;
    
    const htmlContent = `
      <h2>🎉 Fantastic work!</h2>
      <p>You solved <strong>${todaysProblems.length} problem${todaysProblems.length > 1 ? 's' : ''}</strong> today!</p>
      
      <h3>✅ Today's achievements:</h3>
      <ul>
        ${todaysProblems.map(p => `
          <li><strong>${p.title}</strong> - ${p.lang}</li>
        `).join('')}
      </ul>
      
      ${streak > 0 ? `<p>🔥 <strong>Current streak: ${streak} days!</strong></p>` : ''}
      
      ${todaysProblems.length > TRACKER_CONFIG.goals.dailyMinimum ? 
        `<p>💪 You exceeded your daily goal of ${TRACKER_CONFIG.goals.dailyMinimum}! Amazing!</p>` : 
        `<p>✅ Perfect! You hit your daily goal of ${TRACKER_CONFIG.goals.dailyMinimum} problem!</p>`
      }
      
      <p>Keep up the momentum! 🚀</p>
    `;

    const textContent = `
      Great job! ${todaysProblems.length} problem${todaysProblems.length > 1 ? 's' : ''} solved today!
      
      Today's achievements:
      ${todaysProblems.map(p => `- ${p.title} (${p.lang})`).join('\n')}
      
      ${streak > 0 ? `Current streak: ${streak} days!` : ''}
      ${todaysProblems.length > TRACKER_CONFIG.goals.dailyMinimum ? 'You exceeded your daily goal! Amazing!' : 'Perfect! You hit your daily goal!'}
    `;

    await this.sendEmail(subject, htmlContent, textContent);
  }

  /**
   * Send today's question email (supports multiple problems)
   */
  async sendTodaysQuestionEmail(problem, topicName){
    const subject = `📝 Today's LeetCode – ${problem.name}`;
    const html = `
      <h2>Topic: ${topicName}</h2>
      <p>Your problem for today is <strong>${problem.name}</strong> (${problem.difficulty}).</p>
      <p>🔗 <a href="https://leetcode.com/problems/${problem.slug}/">Open on LeetCode</a></p>
      <p>Good luck! You only need to complete <strong>one</strong> problem today.</p>`;
    const text = `Topic: ${topicName}\nToday's problem: ${problem.name} (${problem.difficulty})\nhttps://leetcode.com/problems/${problem.slug}/`;
    await this.sendEmail(subject,html,text);
  }

  /**
   * Send multiple problems email with categorization
   */
  async sendMultipleProblemsEmail(problemDetails, categories) {
    const { unfinished, newProblems, totalCount } = categories;
    
    let subject;
    if (unfinished.length > 0 && newProblems.length > 0) {
      subject = `📝 Today's LeetCode Mix – ${unfinished.length} reminder + ${newProblems.length} new`;
    } else if (unfinished.length > 0) {
      subject = `⏰ Reminder – ${unfinished.length} unfinished problem${unfinished.length > 1 ? 's' : ''}`;
    } else {
      subject = `📝 Today's LeetCode – ${totalCount} problem${totalCount > 1 ? 's' : ''}`;
    }

    let htmlContent = '<h2>🎯 Your LeetCode Problems for Today</h2>';
    let textContent = 'Your LeetCode Problems for Today\n\n';

    // Unfinished problems section
    if (unfinished.length > 0) {
      htmlContent += `
        <h3>⏰ Unfinished from Yesterday (${unfinished.length})</h3>
        <p><em>Complete these first to progress:</em></p>
        <ul>`;
      
      textContent += `⏰ Unfinished from Yesterday (${unfinished.length})\nComplete these first to progress:\n\n`;
      
      unfinished.forEach(problem => {
        const topicName = StudyPlanHelper.getTopicBySlug(problem.slug);
        htmlContent += `
          <li>
            <strong>${problem.name}</strong> (${problem.difficulty}) - ${topicName}
            <br/>🔗 <a href="https://leetcode.com/problems/${problem.slug}/">Solve on LeetCode</a>
          </li>`;
        textContent += `- ${problem.name} (${problem.difficulty}) - ${topicName}\n  https://leetcode.com/problems/${problem.slug}/\n\n`;
      });
      
      htmlContent += '</ul>';
    }

    // New problems section
    if (newProblems.length > 0) {
      htmlContent += `
        <h3>🆕 New Problems (${newProblems.length})</h3>
        <ul>`;
      
      textContent += `\n🆕 New Problems (${newProblems.length})\n\n`;
      
      newProblems.forEach(problem => {
        const topicName = StudyPlanHelper.getTopicBySlug(problem.slug);
        htmlContent += `
          <li>
            <strong>${problem.name}</strong> (${problem.difficulty}) - ${topicName}
            <br/>🔗 <a href="https://leetcode.com/problems/${problem.slug}/">Solve on LeetCode</a>
          </li>`;
        textContent += `- ${problem.name} (${problem.difficulty}) - ${topicName}\n  https://leetcode.com/problems/${problem.slug}/\n\n`;
      });
      
      htmlContent += '</ul>';
    }

    htmlContent += `
      <p>💪 <strong>Goal:</strong> Complete all ${totalCount} problem${totalCount > 1 ? 's' : ''} to unlock tomorrow's challenges!</p>
      <p>🎯 Remember: You need to solve unfinished problems to progress through the study plan.</p>
    `;

    textContent += `\nGoal: Complete all ${totalCount} problem${totalCount > 1 ? 's' : ''} to unlock tomorrow's challenges!\nRemember: You need to solve unfinished problems to progress through the study plan.`;

    await this.sendEmail(subject, htmlContent, textContent);
  }
}

/**
 * Progress Tracker Service
 */
class ProgressTracker {
  constructor() {
    this.leetcodeApi = new LeetCodeAPI();
    this.emailService = new EmailService();
  }

  /**
   * Main daily check function - handles multiple problems
   */
  async runDailyRoutine() {
    console.log('\n🕑 Daily routine - Multi-problem support');
    
    try {
      // Step 1: Check API health with longer initial attempt
      console.log('🏥 Checking LeetCode API health...');
      let apiHealth = await this.leetcodeApi.checkAPIHealth();
      
      if (!apiHealth.healthy) {
        if (apiHealth.circuitBreaker) {
          console.log('🔌 Circuit breaker is active - will retry on next scheduled run');
          return;
        }

        console.log('⚡ API appears to be sleeping, starting wake-up process...');
        const wakeupSuccess = await this.leetcodeApi.wakeUpAPI();
        
        if (!wakeupSuccess) {
          console.log('❌ API failed to wake up after extended attempts');
          console.log('💡 Will retry on next scheduled run');
          return;
        }
      }

      // Step 2: Load progress and settings
      const progress = await databaseService.loadProgress();
      const settings = await databaseService.loadSettings();
      const now = new Date();
      const todayStr = format(now, 'yyyy-MM-dd');
      
      console.log(`📊 Current settings: ${settings.num_questions} problems per day`);
      console.log(`📅 Last sent: ${progress.lastSentDate}, Today: ${todayStr}`);

      // Check if we already sent problems today
      if (progress.lastSentDate === todayStr) {
        console.log('⏭️ Problems already sent today. Skipping daily routine.');
        console.log(`📝 Today's problems: [${progress.sentProblems.map(p => p.slug).join(', ')}]`);
        return;
      }

      // Step 3: Check for solved problems
      console.log('🔍 Checking for solved problems...');
      await this.updateSolvedStatus(progress, STUDY_PLAN.username);

      // Step 4: Calculate what problems to send today
      const todaysCalculation = calculateTodaysProblems(progress, settings);
      
      if (todaysCalculation.problems.length === 0) {
        console.log('🎉 Study plan completed! No more problems to send.');
        return;
      }

      console.log(`📝 Sending ${todaysCalculation.problems.length} problems:`);
      console.log(`  - Unfinished: ${todaysCalculation.unfinished.length}`);
      console.log(`  - New: ${todaysCalculation.newProblems.length}`);

      // Step 5: Get problem details for email
      const problemDetails = this.getProblemDetails(todaysCalculation.problems);
      const unfinishedDetails = problemDetails.filter(p => todaysCalculation.unfinished.includes(p.slug));
      const newProblemDetails = problemDetails.filter(p => todaysCalculation.newProblems.includes(p.slug));

      // Step 6: Send appropriate email
      if (problemDetails.length === 1) {
        // Single problem - use original email format
        const problem = problemDetails[0];
        const topicName = StudyPlanHelper.getTopicBySlug(problem.slug);
        if (todaysCalculation.unfinished.includes(problem.slug)) {
          await this.emailService.sendReminderEmail(problem, topicName);
        } else {
          await this.emailService.sendTodaysQuestionEmail(problem, topicName);
        }
      } else {
        // Multiple problems - use new email format
        await this.emailService.sendMultipleProblemsEmail(problemDetails, {
          unfinished: unfinishedDetails,
          newProblems: newProblemDetails,
          totalCount: problemDetails.length
        });
      }

      // Step 7: Update progress - preserve unsolved problems
      const unsolvedProblems = progress.sentProblems.filter(p => !p.solved);
      const newSentProblems = todaysCalculation.problems.map(slug => {
        // Check if this problem was previously unsolved
        const existingProblem = unsolvedProblems.find(p => p.slug === slug);
        if (existingProblem) {
          return existingProblem; // Keep the existing record
        }
        // Create new record for new problems
        return {
          slug: slug,
          solved: false,
          sentDate: todayStr
        };
      });

      const newProgress = {
        lastSentDate: todayStr,
        sentProblems: newSentProblems,
        studyPlanPosition: todaysCalculation.updatedPosition,
        pendingQueue: todaysCalculation.updatedPendingQueue,
        settingsAtSendTime: {
          num_questions: settings.num_questions,
          timestamp: new Date().toISOString()
        }
      };

      // Save updated progress
      await databaseService.saveProgress(newProgress);
      console.log(`✅ Daily routine completed. Progress saved.`);
    } catch (error) {
      console.error('❌ Daily routine failed:', error);
      throw error;
    }
  }

  /**
   * Enhanced daily routine with rollback support and atomic transactions
   */
  async runDailyRoutineWithRollback() {
    console.log('\n🕑 Daily routine with rollback support - Multi-problem support');
    
    // Import the enhanced database service functions
    const { createCheckpoint, rollbackToCheckpoint, atomicProgressUpdate } = require('./lib/firebase');
    
    let checkpoint;
    
    try {
      // Step 1: Create checkpoint before any changes
      console.log('📋 Creating checkpoint before starting routine...');
      checkpoint = await createCheckpoint();
      
      // Step 2: Check API health with longer initial attempt
      console.log('🏥 Checking LeetCode API health...');
      let apiHealth = await this.leetcodeApi.checkAPIHealth();
      
      if (!apiHealth.healthy) {
        if (apiHealth.circuitBreaker) {
          console.log('🔌 Circuit breaker is active - will retry on next scheduled run');
          return;
        }

        console.log('⚡ API appears to be sleeping, starting wake-up process...');
        const wakeupSuccess = await this.leetcodeApi.wakeUpAPI();
        
        if (!wakeupSuccess) {
          console.log('❌ API failed to wake up after extended attempts');
          console.log('💡 Will retry on next scheduled run');
          return;
        }
      }

      // Step 3: Load progress and settings (using atomic operations)
      const [progress, settings] = await Promise.all([
        databaseService.loadProgress(),
        databaseService.loadSettings()
      ]);
      
      const now = new Date();
      const todayStr = format(now, 'yyyy-MM-dd');
      
      console.log(`📊 Current settings: ${settings.num_questions} problems per day`);
      console.log(`📅 Last sent: ${progress.lastSentDate}, Today: ${todayStr}`);

      // Check if we already sent problems today
      if (progress.lastSentDate === todayStr) {
        console.log('⏭️ Problems already sent today. Skipping daily routine.');
        console.log(`📝 Today's problems: [${progress.sentProblems.map(p => p.slug).join(', ')}]`);
        return;
      }

      // Step 4: Atomically update solved status
      console.log('🔍 Checking for solved problems with atomic update...');
      const progressWithUpdatedSolved = await atomicProgressUpdate('default', async (currentProgress) => {
        await this.updateSolvedStatusInProgress(currentProgress, STUDY_PLAN.username);
        return currentProgress;
      });

      // Step 5: Calculate what problems to send today
      const todaysCalculation = calculateTodaysProblems(progressWithUpdatedSolved, settings);
      
      if (todaysCalculation.problems.length === 0) {
        console.log('🎉 Study plan completed! No more problems to send.');
        return;
      }

      console.log(`📝 Sending ${todaysCalculation.problems.length} problems:`);
      console.log(`  - Unfinished: ${todaysCalculation.unfinished.length}`);
      console.log(`  - New: ${todaysCalculation.newProblems.length}`);

      // Step 6: Get problem details for email
      const problemDetails = this.getProblemDetails(todaysCalculation.problems);
      const unfinishedDetails = problemDetails.filter(p => todaysCalculation.unfinished.includes(p.slug));
      const newProblemDetails = problemDetails.filter(p => todaysCalculation.newProblems.includes(p.slug));

      // Step 7: Send appropriate email (this is the critical operation that might fail)
      console.log('📧 Sending email notification...');
      if (problemDetails.length === 1) {
        // Single problem - use original email format
        const problem = problemDetails[0];
        const topicName = StudyPlanHelper.getTopicBySlug(problem.slug);
        if (todaysCalculation.unfinished.includes(problem.slug)) {
          await this.emailService.sendReminderEmail(problem, topicName);
        } else {
          await this.emailService.sendTodaysQuestionEmail(problem, topicName);
        }
      } else {
        // Multiple problems - use new email format
        await this.emailService.sendMultipleProblemsEmail(problemDetails, {
          unfinished: unfinishedDetails,
          newProblems: newProblemDetails,
          totalCount: problemDetails.length
        });
      }
      
      console.log('✅ Email sent successfully');

      // Step 8: Atomically update progress - only after email success
      console.log('💾 Updating progress with atomic transaction...');
      await atomicProgressUpdate('default', (currentProgress) => {
        // Preserve unsolved problems
        const unsolvedProblems = currentProgress.sentProblems.filter(p => !p.solved);
        const newSentProblems = todaysCalculation.problems.map(slug => {
          // Check if this problem was previously unsolved
          const existingProblem = unsolvedProblems.find(p => p.slug === slug);
          if (existingProblem) {
            return existingProblem; // Keep the existing record
          }
          // Create new record for new problems
          return {
            slug: slug,
            solved: false,
            sentDate: todayStr
          };
        });

        return {
          ...currentProgress,
          lastSentDate: todayStr,
          sentProblems: newSentProblems,
          studyPlanPosition: todaysCalculation.updatedPosition,
          pendingQueue: todaysCalculation.updatedPendingQueue,
          settingsAtSendTime: {
            num_questions: settings.num_questions,
            timestamp: new Date().toISOString()
          }
        };
      });

      console.log('✅ Daily routine completed successfully with rollback protection');
      
    } catch (error) {
      console.error('❌ Daily routine failed, initiating rollback...', error.message);
      
      // Rollback to checkpoint on any failure
      if (checkpoint) {
        try {
          await rollbackToCheckpoint(checkpoint);
          console.log('🔄 Successfully rolled back to checkpoint');
        } catch (rollbackError) {
          console.error('💥 CRITICAL: Rollback failed!', rollbackError.message);
          // This is a critical failure - the system is in an inconsistent state
          throw new Error(`Daily routine failed and rollback failed: ${rollbackError.message}`);
        }
      }
      
      // Re-throw the original error
      throw error;
    }
  }

  /**
   * Update solved status for sent problems
   */
  async updateSolvedStatus(progress, username) {
    try {
      console.log(`🔍 Checking recent submissions for ${username}...`);
      const submissions = await this.leetcodeApi.getUserSubmissions(username, 20); // 20 is enough for recent submissions
      
      if (!submissions.submission || !Array.isArray(submissions.submission)) {
        console.log('⚠️ Invalid API response structure');
        return;
      }

      // Only look at accepted submissions and convert timestamps
      const acceptedSubmissions = submissions.submission
        .filter(s => (s.statusDisplay || '').toLowerCase() === 'accepted')
        .map(s => ({
          slug: s.titleSlug,
          timestamp: new Date(parseInt(s.timestamp) * 1000)
        }));

      console.log(`📝 Found ${acceptedSubmissions.length} recent accepted submissions:`);
      acceptedSubmissions.forEach(sub => {
        console.log(`   ${sub.slug} at ${sub.timestamp.toLocaleString()}`);
      });

      // Update solved status for each unsolved sent problem
      let solvedCount = 0;
      progress.sentProblems.forEach(sentProblem => {
        if (sentProblem.solved) {
          console.log(`\n⏭️ ${sentProblem.slug} already marked as solved`);
          return;
        }

        // Get assignment time
        const assignmentTime = new Date(sentProblem.sentDate);
        console.log(`\n🔍 Checking ${sentProblem.slug}:`);
        console.log(`   Assigned: ${assignmentTime.toLocaleString()}`);

        // Look for an accepted submission after assignment
        const matchingSubmission = acceptedSubmissions.find(sub => 
          sub.slug === sentProblem.slug && sub.timestamp > assignmentTime
        );

        if (matchingSubmission) {
          sentProblem.solved = true;
          sentProblem.solvedTimestamp = matchingSubmission.timestamp.toISOString();
          solvedCount++;
          console.log(`✅ Solved at ${matchingSubmission.timestamp.toLocaleString()}`);
        } else {
          console.log(`❌ No accepted submissions since assignment`);
        }
      });

      if (solvedCount > 0) {
        await databaseService.saveProgress(progress);
        console.log(`\n🎉 Updated ${solvedCount} problems as solved!`);
      } else {
        console.log('\n📝 No new problems marked as solved');
      }

    } catch (error) {
      console.error('❌ Error checking submissions:', error.message);
      if (error.response) {
        console.error('API Response Status:', error.response.status);
        console.error('API Response Data:', error.response.data);
      }
    }
  }

  /**
   * Update solved status for sent problems (internal method for atomic operations)
   * This modifies the progress object in-place
   */
  async updateSolvedStatusInProgress(progress, username) {
    try {
      console.log(`🔍 Checking recent submissions for ${username}...`);
      const submissions = await this.leetcodeApi.getUserSubmissions(username, 20);
      
      if (!submissions.submission || !Array.isArray(submissions.submission)) {
        console.log('⚠️ Invalid API response structure');
        return;
      }

      // Validate API response with our new framework
      const validationResult = DataValidator.validateSafe(
        { response: submissions, endpoint: 'getUserSubmissions' },
        'submission-response',
        'updateSolvedStatusInProgress'
      );

      if (!validationResult.success) {
        console.warn(`⚠️ API response validation failed: ${validationResult.error.message}`);
        // Continue with degraded functionality rather than failing completely
      }

      // Use DateUtils for robust timestamp parsing
      const acceptedSubmissions = submissions.submission
        .filter(s => (s.statusDisplay || '').toLowerCase() === 'accepted')
        .map(s => {
          try {
            const timestamp = DateUtils.parseApiTimestamp(s.timestamp, `submission-${s.titleSlug}`);
            return {
              slug: s.titleSlug,
              timestamp: timestamp
            };
          } catch (error) {
            console.warn(`⚠️ Invalid timestamp for ${s.titleSlug}: ${error.message}`);
            return null;
          }
        })
        .filter(Boolean); // Remove null entries

      console.log(`📝 Found ${acceptedSubmissions.length} valid recent accepted submissions`);

      // Update solved status for each unsolved sent problem
      let solvedCount = 0;
      progress.sentProblems.forEach(sentProblem => {
        if (sentProblem.solved) {
          return; // Already solved, skip
        }

        try {
          // Look for an accepted submission after assignment using DateUtils
          const matchingSubmission = acceptedSubmissions.find(sub => {
            if (sub.slug !== sentProblem.slug) return false;
            
            return DateUtils.isSubmissionAfterAssignment(
              sub.timestamp,
              sentProblem.sentDate,
              `progress-check-${sentProblem.slug}`
            );
          });

          if (matchingSubmission) {
            sentProblem.solved = true;
            sentProblem.solvedTimestamp = matchingSubmission.timestamp.toISOString();
            solvedCount++;
            console.log(`✅ ${sentProblem.slug} solved at ${matchingSubmission.timestamp.toLocaleString()}`);
          }
        } catch (error) {
          console.warn(`⚠️ Error processing ${sentProblem.slug}:`, error.message);
        }
      });

      if (solvedCount > 0) {
        console.log(`🎉 Updated ${solvedCount} problems as solved!`);
      } else {
        console.log('📝 No new problems marked as solved');
      }

    } catch (error) {
      console.error('❌ Error checking submissions:', error.message);
      // Don't throw here - we want to continue with the routine even if submission checking fails
    }
  }

  /**
   * Get problem details for a list of slugs
   */
  getProblemDetails(slugs) {
    return slugs.map(slug => {
      const problem = StudyPlanHelper.getProblemBySlug(slug);
      return problem || { slug, name: slug, difficulty: 'Unknown' };
    }).filter(Boolean);
  }

  /**
   * Check if we need to send new week notification
   */
  async checkNewWeek() {
    const currentWeek = StudyPlanHelper.getCurrentWeek();
    const weekData = STUDY_PLAN.weeks[currentWeek];
    
    if (weekData) {
      // For simplicity, we'll check if it's Monday (start of week)
      const today = new Date();
      if (today.getDay() === 1) { // Monday = 1
        console.log(`📚 Starting Week ${currentWeek}: ${weekData.theme}`);
        await this.emailService.sendNewQuestionEmail(
          currentWeek, 
          weekData.theme, 
          weekData.problems
        );
      }
    }
  }

  /**
   * Test the tracker manually
   */
  async testTracker() {
    console.log('🧪 Testing LeetCode Progress Tracker (Multi-problem version)...\n');
    
    try {
      // Test API connection
      console.log('1. Testing API connection...');
      const profile = await this.leetcodeApi.getUserProfile(STUDY_PLAN.username);
      console.log(`✅ Connected! User: ${profile.username}, Ranking: ${profile.ranking}\n`);

      // Test submissions
      console.log('2. Testing submissions...');
      const submissions = await this.leetcodeApi.getUserSubmissions(STUDY_PLAN.username, 5);
      console.log(`✅ Recent submissions: ${submissions.count} total, showing ${submissions.submission.length}\n`);

      // Test study plan
      console.log('3. Testing study plan...');
      const orderedProblems = StudyPlanHelper.getOrderedProblemList();
      console.log(`✅ Total problems in study plan: ${orderedProblems.length}`);
      console.log(`✅ Topics: ${STUDY_PLAN.topics.length}\n`);

      // Test settings and progress
      console.log('4. Testing settings and progress...');
      const settings = await databaseService.loadSettings();
      const progress = await databaseService.loadProgress();
      console.log(`✅ Settings loaded: ${settings.num_questions} problems per day`);
      console.log(`✅ Progress loaded: Position ${progress.studyPlanPosition}/${orderedProblems.length}`);
      console.log(`✅ Sent problems: ${progress.sentProblems.length}, Pending queue: ${progress.pendingQueue.length}\n`);

      // Test problem calculation
      console.log('5. Testing problem calculation...');
      const todaysCalculation = calculateTodaysProblems(progress, settings);
      console.log(`✅ Would send ${todaysCalculation.problems.length} problems today:`);
      console.log(`   - Unfinished: ${todaysCalculation.unfinished.length}`);
      console.log(`   - New: ${todaysCalculation.newProblems.length}`);
      console.log(`   - Updated position: ${todaysCalculation.updatedPosition}\n`);

      // Test submission checking
      console.log('6. Testing submission checking...');
      const yesterdayStr = format(new Date(Date.now() - 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      
      try {
        const yesterdaySubmissions = await this.leetcodeApi.getSubmissionsForDate(STUDY_PLAN.username, yesterdayStr);
        const todaySubmissions = await this.leetcodeApi.getSubmissionsForDate(STUDY_PLAN.username, todayStr);
        
        console.log(`✅ Yesterday (${yesterdayStr}): ${yesterdaySubmissions.length} accepted submissions`);
        console.log(`✅ Today (${todayStr}): ${todaySubmissions.length} accepted submissions`);
        
        if (yesterdaySubmissions.length > 0) {
          console.log(`   Yesterday's problems: [${yesterdaySubmissions.map(s => s.titleSlug).join(', ')}]`);
        }
      } catch (error) {
        console.log(`❌ Submission checking failed: ${error.message}`);
      }

      // Test email (optional)
      if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
        console.log('7. Testing email (sending test email)...');
        await this.emailService.sendEmail(
          '🧪 LeetCode Tracker Test - Multi-problem Support',
          '<h2>🎉 Test email successful!</h2><p>Your LeetCode tracker with multi-problem support is working!</p>',
          'Test email successful! Your LeetCode tracker with multi-problem support is working!'
        );
        console.log('✅ Email test successful!\n');
      } else {
        console.log('7. ⚠️ Email not configured (set EMAIL_USER and EMAIL_PASS in .env)\n');
      }

      console.log('🎉 All tests passed! Multi-problem tracker is ready to use.\n');
      
    } catch (error) {
      console.error('❌ Test failed:', error.message);
    }
  }

  /**
   * Start scheduled jobs
   */
  startScheduledJobs() {
    console.log('⏰ Starting scheduled jobs...');
    
    cron.schedule(TRACKER_CONFIG.email.schedules.dailyCheck, () => {
      this.runDailyRoutine();
    });

    console.log('✅ Scheduled job registered!');
    console.log(`🕑 Daily routine cron: ${TRACKER_CONFIG.email.schedules.dailyCheck}`);
  }
}

/**
 * CLI Interface
 */
async function main() {
  const tracker = new ProgressTracker();
  const command = process.argv[2];
  const subcommand = process.argv[3];

  switch (command) {
    case 'test':
      await tracker.testTracker();
      break;
    
    case 'check':
      await tracker.runDailyRoutine();
      break;
    
    case 'start':
      console.log('🚀 Starting LeetCode Progress Tracker...');
      tracker.startScheduledJobs();
      console.log('📱 Tracker is running! Press Ctrl+C to stop.');
      break;

    case 'settings':
      await handleSettingsCommand(subcommand);
      break;

    case 'status':
      await showStatus();
      break;

    case 'diagnose':
      const DiagnosticTool = require('./diagnose-progress');
      const diagnostic = new DiagnosticTool();
      await diagnostic.run();
      break;

    case 'wake':
      console.log('🌅 Waking up external API...');
      const api = new LeetCodeAPI();
      await api.wakeUpAPI();
      const health = await api.checkAPIHealth();
      if (health.healthy) {
        console.log('✅ API is ready for use!');
      } else {
        console.log('⚠️ API may still be starting up. Wait a few minutes and try again.');
      }
      break;

    case 'force-check':
      console.log('🔧 Force checking submissions and updating progress...');
      const forceTracker = new ProgressTracker();
      const forceProgress = await databaseService.loadProgress();
      const forceSettings = await databaseService.loadSettings();
      const yesterdayStr = format(new Date(Date.now() - 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
      
      console.log(`🔍 Force checking ${yesterdayStr} submissions...`);
      await forceTracker.updateSolvedStatus(forceProgress, yesterdayStr, process.env.LEETCODE_USERNAME);
      
      console.log('\n📊 Updated progress:');
      const updatedProgress = await databaseService.loadProgress();
      updatedProgress.sentProblems.forEach((problem, i) => {
        console.log(`  ${i + 1}. ${problem.slug} - solved: ${problem.solved} (sent: ${problem.sentDate})`);
      });
      break;
    
    default:
      console.log(`
🎯 LeetCode Progress Tracker - Multi-Problem Support

Usage:
  node tracker.js test                    - Test all components
  node tracker.js check                   - Run daily routine once (same as 2 AM job)
  node tracker.js start                   - Start scheduled monitoring
  node tracker.js settings [get|set]      - Manage settings
  node tracker.js status                  - Show current status
  node tracker.js diagnose               - Run diagnostic tool to troubleshoot issues
  node tracker.js wake                    - Wake up external API (fixes timeout issues)
  node tracker.js force-check            - Force check yesterday's submissions and update progress

Settings Management:
  node tracker.js settings get            - Show current settings
  node tracker.js settings set <num>      - Set number of daily problems (1-10)

Examples:
  node tracker.js settings set 3          - Send 3 problems per day
  node tracker.js settings get            - View current settings

Make sure to:
1. Copy env.example to .env and configure your settings
2. Set up your email credentials for notifications
3. Use the settings command to configure daily problem count
      `);
  }
}

/**
 * Handle settings command
 */
async function handleSettingsCommand(subcommand) {
  const settings = await databaseService.loadSettings();

  switch (subcommand) {
    case 'get':
      console.log('\n⚙️ Current Settings:');
      console.log(`📊 Daily problems: ${settings.num_questions}`);
      console.log(`📧 Email enabled: ${settings.email_enabled}`);
      console.log(`📅 Created: ${settings.created_at}`);
      console.log(`🔄 Last updated: ${settings.updated_at}\n`);
      break;

    case 'set':
      const newNum = parseInt(process.argv[4]);
      if (isNaN(newNum)) {
        console.log('❌ Please provide a valid number');
        console.log('Usage: node tracker.js settings set <number>');
        return;
      }

      const validatedNum = validateNumQuestions(newNum);
      const updatedSettings = await databaseService.saveSettings({
        ...settings,
        num_questions: validatedNum
      });

      console.log(`✅ Settings updated!`);
      console.log(`📊 Daily problems: ${validatedNum}`);
      
      if (validatedNum !== newNum) {
        console.log(`⚠️ Number adjusted to valid range (1-10)`);
      }
      
      console.log('\n💡 Changes will take effect on the next daily routine.\n');
      break;

    default:
      console.log('\n⚙️ Settings Commands:');
      console.log('  node tracker.js settings get      - Show current settings');
      console.log('  node tracker.js settings set <n>  - Set daily problems (1-10)\n');
  }
}

/**
 * Show current status
 */
async function showStatus() {
  const settings = await databaseService.loadSettings();
  const progress = await databaseService.loadProgress();
  const orderedProblems = StudyPlanHelper.getOrderedProblemList();

  console.log('\n📊 LeetCode Tracker Status\n');
  
  console.log('⚙️ Settings:');
  console.log(`  Daily problems: ${settings.num_questions}`);
  console.log(`  Email enabled: ${settings.email_enabled}\n`);
  
  console.log('📈 Progress:');
  console.log(`  Study plan position: ${progress.studyPlanPosition}/${orderedProblems.length}`);
  console.log(`  Last sent: ${progress.lastSentDate || 'Never'}`);
  console.log(`  Sent problems: ${progress.sentProblems.length}`);
  console.log(`  Pending queue: ${progress.pendingQueue.length}\n`);

  if (progress.sentProblems.length > 0) {
    const solvedCount = progress.sentProblems.filter(p => p.solved).length;
    const unsolvedCount = progress.sentProblems.length - solvedCount;
    
    console.log('📋 Last Sent Problems:');
    console.log(`  Solved: ${solvedCount}`);
    console.log(`  Unsolved: ${unsolvedCount}`);
    
    if (unsolvedCount > 0) {
      console.log('\n⏰ Unsolved problems:');
      progress.sentProblems
        .filter(p => !p.solved)
        .forEach(p => {
          const problem = StudyPlanHelper.getProblemBySlug(p.slug);
          console.log(`  - ${problem?.name || p.slug} (${p.sentDate})`);
        });
    }
  }

  console.log('\n💡 Next routine will run at 2:00 AM\n');
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { ProgressTracker, LeetCodeAPI, EmailService };