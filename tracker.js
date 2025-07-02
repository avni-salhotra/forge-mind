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
   * Get user's recent submissions
   */
  async getUserSubmissions(username, limit = 20) {
    try {
      const response = await axios.get(
        `${this.baseURL}/${username}/acSubmission?limit=${limit}`,
        { timeout: this.timeout }
      );
      return response.data;
    } catch (error) {
      console.error('❌ Error fetching user submissions:', error.message);
      throw error;
    }
  }

  /**
   * Get user profile data
   */
  async getUserProfile(username) {
    try {
      const response = await axios.get(
        `${this.baseURL}/${username}`,
        { timeout: this.timeout }
      );
      return response.data;
    } catch (error) {
      console.error('❌ Error fetching user profile:', error.message);
      throw error;
    }
  }

  /**
   * Get today's submissions for a user
   */
  async getTodaysSubmissions(username) {
    const submissions = await this.getUserSubmissions(username, 50);
    const today = startOfDay(new Date());
    
    return submissions.submission.filter(sub => {
      const submissionDate = startOfDay(new Date(parseInt(sub.timestamp) * 1000));
      return submissionDate.getTime() === today.getTime();
    });
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
      
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      const yesterdayStr = format(new Date(Date.now() - 86400000), 'yyyy-MM-dd');
      
      const username = STUDY_PLAN.username;

      console.log(`📊 Current settings: ${settings.num_questions} problems per day`);
      console.log(`📅 Last sent: ${progress.lastSentDate}, Today: ${todayStr}`);

      // Step 1: Check if any problems from yesterday were solved
      if (progress.lastSentDate === yesterdayStr && progress.sentProblems.length > 0) {
        console.log('🔍 Checking yesterday\'s submissions...');
        await this.updateSolvedStatus(progress, yesterdayStr, username);
      }

      // Step 2: Calculate what problems to send today
      const todaysCalculation = calculateTodaysProblems(progress, settings);
      
      if (todaysCalculation.problems.length === 0) {
        console.log('🎉 Study plan completed! No more problems to send.');
        return;
      }

      console.log(`📝 Sending ${todaysCalculation.problems.length} problems:`);
      console.log(`  - Unfinished: ${todaysCalculation.unfinished.length}`);
      console.log(`  - New: ${todaysCalculation.newProblems.length}`);

      // Step 3: Get problem details for email
      const problemDetails = this.getProblemDetails(todaysCalculation.problems);
      const unfinishedDetails = problemDetails.filter(p => todaysCalculation.unfinished.includes(p.slug));
      const newProblemDetails = problemDetails.filter(p => todaysCalculation.newProblems.includes(p.slug));

      // Step 4: Send appropriate email
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

      // Step 5: Update progress - preserve unsolved problems
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
      const submissions = await this.leetcodeApi.getUserSubmissions(username, 100);
      
      // Filter submissions from the check date
      const dateSubmissions = submissions.submission.filter(s => {
        const submissionDate = format(new Date(parseInt(s.timestamp) * 1000), 'yyyy-MM-dd');
        return submissionDate === checkDate;
      });

      console.log(`📊 Found ${dateSubmissions.length} submissions from ${checkDate}`);

      // Update solved status for each sent problem
      let solvedCount = 0;
      progress.sentProblems.forEach(sentProblem => {
        const wasSolved = dateSubmissions.some(sub => sub.titleSlug === sentProblem.slug);
        if (wasSolved && !sentProblem.solved) {
          sentProblem.solved = true;
          solvedCount++;
          console.log(`✅ Marked ${sentProblem.slug} as solved`);
        }
      });

      if (solvedCount > 0) {
        await databaseService.saveProgress(progress);
        console.log(`🎉 Updated ${solvedCount} problems as solved!`);
      }

    } catch (error) {
      console.error('❌ Error checking submissions:', error.message);
      console.log('⚠️ Continuing with conservative assumption (unsolved)');
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

      // Test email (optional)
      if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
        console.log('6. Testing email (sending test email)...');
        await this.emailService.sendEmail(
          '🧪 LeetCode Tracker Test - Multi-problem Support',
          '<h2>🎉 Test email successful!</h2><p>Your LeetCode tracker with multi-problem support is working!</p>',
          'Test email successful! Your LeetCode tracker with multi-problem support is working!'
        );
        console.log('✅ Email test successful!\n');
      } else {
        console.log('6. ⚠️ Email not configured (set EMAIL_USER and EMAIL_PASS in .env)\n');
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
    
    default:
      console.log(`
🎯 LeetCode Progress Tracker - Multi-Problem Support

Usage:
  node tracker.js test                    - Test all components
  node tracker.js check                   - Run daily routine once (same as 2 AM job)
  node tracker.js start                   - Start scheduled monitoring
  node tracker.js settings [get|set]      - Manage settings
  node tracker.js status                  - Show current status

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