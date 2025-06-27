#!/usr/bin/env node

/**
 * LeetCode Progress Tracker
 * 
 * Main application that:
 * 1. Checks daily LeetCode progress against study plan
 * 2. Sends email notifications based on progress
 * 3. Tracks streaks and overall progress
 * 4. Runs scheduled checks via cron jobs
 */

require('dotenv').config();
const axios = require('axios');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const { format, startOfDay, isToday, parseISO } = require('date-fns');
const fs = require('fs');
const path = require('path');

const { STUDY_PLAN, TRACKER_CONFIG, StudyPlanHelper } = require('./study-plan');

const PROGRESS_PATH = path.join(__dirname,'progress.json');

function loadProgress(){
  try{ return JSON.parse(fs.readFileSync(PROGRESS_PATH,'utf-8'));}catch(e){return { lastSentDate:null,lastSlug:null,solved:true };}
}

function saveProgress(data){ fs.writeFileSync(PROGRESS_PATH,JSON.stringify(data,null,2)); }

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
   * Send today's question email
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
}

/**
 * Progress Tracker Service
 */
class ProgressTracker {
  constructor() {
    this.leetcodeAPI = new LeetCodeAPI();
    this.emailService = new EmailService();
  }

  /**
   * Main daily check function
   */
  async runDailyRoutine() {
    console.log('\n🕑 Daily routine');
    const todayStr=format(new Date(),'yyyy-MM-dd');
    const yesterdayStr=format(new Date(Date.now()-86400000),'yyyy-MM-dd');
    const progress = loadProgress();
    const username = STUDY_PLAN.username;

    // if we sent a question yesterday and it's not marked solved, check if solved now
    if(progress.lastSentDate===yesterdayStr && progress.solved===false && progress.lastSlug){
      const ySubmissions = await this.leetcodeAPI.getUserSubmissions(username,50);
      const solvedYesterday = ySubmissions.submission.some(s=>{
        const d = format(startOfDay(new Date(parseInt(s.timestamp)*1000)),'yyyy-MM-dd');
        return d===yesterdayStr && s.titleSlug===progress.lastSlug;
      });
      if(solvedYesterday){ progress.solved=true; saveProgress(progress);} 
    }

    // If yesterday unsolved, send reminder and exit
    if(progress.lastSentDate===yesterdayStr && progress.solved===false){
      const problemInfo = StudyPlanHelper.getProblemBySlug(progress.lastSlug);
      const topicName = StudyPlanHelper.getTopicBySlug(progress.lastSlug);
      await this.emailService.sendReminderEmail(problemInfo, topicName);
      console.log('📧 Reminder email sent for unsolved problem');
      return;
    }

    // Need to send a new problem for today
    const next = StudyPlanHelper.getNextSlug(progress.lastSlug);
    if(!next){ console.error('No problems in study plan'); return; }
    const topicName = StudyPlanHelper.getTopicBySlug(next.slug);
    await this.emailService.sendTodaysQuestionEmail(next, topicName);
    console.log(`📧 Today's question email sent: ${next.name}`);

    // update progress
    saveProgress({ lastSentDate: todayStr, lastSlug: next.slug, solved:false });
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
    console.log('🧪 Testing LeetCode Progress Tracker...\n');
    
    try {
      // Test API connection
      console.log('1. Testing API connection...');
      const profile = await this.leetcodeAPI.getUserProfile(STUDY_PLAN.username);
      console.log(`✅ Connected! User: ${profile.username}, Ranking: ${profile.ranking}\n`);

      // Test submissions
      console.log('2. Testing submissions...');
      const submissions = await this.leetcodeAPI.getUserSubmissions(STUDY_PLAN.username, 5);
      console.log(`✅ Recent submissions: ${submissions.count} total, showing ${submissions.submission.length}\n`);

      // Test study plan
      console.log('3. Testing study plan...');
      const currentWeek = StudyPlanHelper.getCurrentWeek();
      const currentProblems = StudyPlanHelper.getCurrentWeekProblems();
      console.log(`✅ Current week: ${currentWeek}`);
      console.log(`✅ Current problems: ${currentProblems.length}\n`);

      // Test email (optional)
      if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
        console.log('4. Testing email (sending test email)...');
        await this.emailService.sendEmail(
          '🧪 LeetCode Tracker Test',
          '<h2>🎉 Test email successful!</h2><p>Your LeetCode tracker is working!</p>',
          'Test email successful! Your LeetCode tracker is working!'
        );
        console.log('✅ Email test successful!\n');
      } else {
        console.log('4. ⚠️ Email not configured (set EMAIL_USER and EMAIL_PASS in .env)\n');
      }

      console.log('🎉 All tests passed! Tracker is ready to use.\n');
      
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
    
    default:
      console.log(`
🎯 LeetCode Progress Tracker

Usage:
  node tracker.js test     - Test all components
  node tracker.js check    - Run daily routine once (same as 2 AM job)
  node tracker.js start    - Start scheduled monitoring

Make sure to:
1. Copy env.example to .env and configure your settings
2. Set up your email credentials for notifications
      `);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { ProgressTracker, LeetCodeAPI, EmailService }; 