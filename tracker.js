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
   * Get submissions for a specific date
   */
  async getSubmissionsForDate(username, targetDate) {
    try {
      const submissions = await this.getUserSubmissions(username, 100);
      
      if (!submissions.submission || !Array.isArray(submissions.submission)) {
        console.log('⚠️ Invalid API response structure for date submissions');
        return [];
      }
      
      return submissions.submission.filter(sub => {
        const submissionDateUTC = new Date(parseInt(sub.timestamp) * 1000)
          .toISOString()
          .substring(0, 10);
        return submissionDateUTC === targetDate && (sub.statusDisplay || '').toLowerCase() === 'accepted';
      });
    } catch (error) {
      console.error(`❌ Error fetching submissions for ${targetDate}:`, error.message);
      return [];
    }
  }

  /**
   * Get today's submissions for a user (convenience method)
   */
  async getTodaysSubmissions(username) {
    const today = format(new Date(), 'yyyy-MM-dd');
    return this.getSubmissionsForDate(username, today);
  }

  /**
   * Wake up the API (useful for cold starts on Render/Heroku)
   */
  async wakeUpAPI() {
    console.log('🌅 Waking up external API...');
    try {
      const response = await axios.get(`${this.baseURL}/daily`, { 
        timeout: 30000 // Give it plenty of time for cold start
      });
      console.log('✅ API is awake and responsive');
      return true;
    } catch (error) {
      console.log(`⚠️ API wake-up failed: ${error.message}`);
      console.log('💡 This might slow down subsequent API calls');
      return false;
    }
  }

  /**
   * Check API health
   */
  async checkAPIHealth() {
    try {
      const start = Date.now();
      const response = await axios.get(`${this.baseURL}/daily`, { timeout: 5000 });
      const duration = Date.now() - start;
      
      console.log(`✅ API Health: OK (${duration}ms response time)`);
      return { healthy: true, responseTime: duration };
    } catch (error) {
      console.log(`❌ API Health: POOR (${error.message})`);
      return { healthy: false, error: error.message };
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
      // Load current progress and settings
      const progress = await databaseService.loadProgress();
      const settings = await databaseService.loadSettings();
      
      // Use UTC to avoid timezone issues
      const now = new Date();
      const todayStr = format(now, 'yyyy-MM-dd');
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const yesterdayStr = format(yesterday, 'yyyy-MM-dd');
      
      console.log(`📅 Date calculation: Today=${todayStr}, Yesterday=${yesterdayStr}, Server Time=${now.toISOString()}`);
      
      const username = STUDY_PLAN.username;

      console.log(`📊 Current settings: ${settings.num_questions} problems per day`);
      console.log(`📅 Last sent: ${progress.lastSentDate}, Today: ${todayStr}`);

      // Check if we already sent problems today
      if (progress.lastSentDate === todayStr) {
        console.log('⏭️ Problems already sent today. Skipping daily routine.');
        console.log(`📝 Today's problems: [${progress.sentProblems.map(p => p.slug).join(', ')}]`);
        return;
      }

      // Step 1: Check API health and wake it up if needed
      console.log('🏥 Checking API health...');
      const apiHealth = await this.leetcodeApi.checkAPIHealth();
      
      if (!apiHealth.healthy) {
        console.log('⚡ API appears to be sleeping, attempting wake-up...');
        await this.leetcodeApi.wakeUpAPI();
      }

      // Step 2: Check if any problems from yesterday were solved
      if (progress.lastSentDate === yesterdayStr && progress.sentProblems.length > 0) {
        console.log('🔍 Checking yesterday\'s submissions...');
        await this.updateSolvedStatus(progress, yesterdayStr, username);
      }

      // Step 3: Calculate what problems to send today
      const todaysCalculation = calculateTodaysProblems(progress, settings);
      
      if (todaysCalculation.problems.length === 0) {
        console.log('🎉 Study plan completed! No more problems to send.');
        return;
      }

      console.log(`📝 Sending ${todaysCalculation.problems.length} problems:`);
      console.log(`  - Unfinished: ${todaysCalculation.unfinished.length}`);
      console.log(`  - New: ${todaysCalculation.newProblems.length}`);

      // Step 4: Get problem details for email
      const problemDetails = this.getProblemDetails(todaysCalculation.problems);
      const unfinishedDetails = problemDetails.filter(p => todaysCalculation.unfinished.includes(p.slug));
      const newProblemDetails = problemDetails.filter(p => todaysCalculation.newProblems.includes(p.slug));

      // Step 5: Send appropriate email
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

      // Step 6: Update progress - preserve unsolved problems
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
   * Update solved status for sent problems
   */
  async updateSolvedStatus(progress, checkDate, username) {
    try {
      console.log(`🔍 Checking submissions for ${username} on ${checkDate}...`);
      const submissions = await this.leetcodeApi.getUserSubmissions(username, 100);
      
      // Debug: Log API response structure
      console.log(`📊 API Response structure:`, {
        hasSubmission: !!submissions.submission,
        submissionCount: submissions.submission?.length || 0,
        totalCount: submissions.count || 0
      });

      if (!submissions.submission || !Array.isArray(submissions.submission)) {
        console.log('⚠️ Invalid API response structure - no submissions array found');
        return;
      }
      
      // Use UTC date string to avoid timezone mismatch between server and LeetCode timestamps
      const dateSubmissions = submissions.submission.filter(s => {
        const submissionDateUTC = new Date(parseInt(s.timestamp) * 1000)
          .toISOString()
          .substring(0, 10); // YYYY-MM-DD in UTC

        const isCorrectDate = submissionDateUTC === checkDate;
        const isAccepted = (s.statusDisplay || '').toLowerCase() === 'accepted';
        return isCorrectDate && isAccepted;
      });

      console.log(`📊 Found ${dateSubmissions.length} total submissions from ${checkDate}`);
      
      // Debug: Show what problems we're looking for
      const problemSlugs = progress.sentProblems.map(p => p.slug);
      console.log(`🔍 Looking for these problem slugs: [${problemSlugs.join(', ')}]`);
      
      // Debug: Show what submissions we found
      if (dateSubmissions.length > 0) {
        const foundSlugs = dateSubmissions.map(s => s.titleSlug);
        console.log(`📋 Found submissions for slugs: [${foundSlugs.join(', ')}]`);
      }

      // Update solved status for each sent problem
      let solvedCount = 0;
      progress.sentProblems.forEach(sentProblem => {
        if (sentProblem.solved) {
          console.log(`⏭️ ${sentProblem.slug} already marked as solved`);
          return;
        }

        const wasSolved = dateSubmissions.some(sub => sub.titleSlug === sentProblem.slug);
        if (wasSolved) {
          sentProblem.solved = true;
          sentProblem.solvedDate = checkDate;
          solvedCount++;
          console.log(`✅ Marked ${sentProblem.slug} as solved on ${checkDate}`);
        } else {
          console.log(`❌ ${sentProblem.slug} not found in ${checkDate} submissions`);
        }
      });

      if (solvedCount > 0) {
        await databaseService.saveProgress(progress);
        console.log(`🎉 Updated ${solvedCount} problems as solved and saved to Firebase!`);
      } else {
        console.log(`📝 No new problems marked as solved for ${checkDate}`);
      }

    } catch (error) {
      console.error('❌ Error checking submissions:', error.message);
      if (error.response) {
        console.error('API Response Status:', error.response.status);
        console.error('API Response Data:', error.response.data);
      }
      
      console.log('⚠️ API unavailable - using conservative approach');
      console.log('💡 This means unsolved problems will be resent tomorrow');
      console.log('💡 If you solved problems yesterday, they\'ll be detected when API is back');
      
      // Mark all problems as unsolved since we can't verify
      progress.sentProblems.forEach(sentProblem => {
        if (!sentProblem.solved) {
          console.log(`⏳ ${sentProblem.slug} - status unknown (assuming unsolved)`);
        }
      });
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