#!/usr/bin/env node

require('dotenv').config();
const axios = require('axios');
const { format } = require('date-fns');
const { databaseService } = require('./lib/firebase');

class DiagnosticTool {
  constructor() {
    this.databaseService = databaseService;
    this.baseURL = process.env.LEETCODE_API_URL || 'https://alfa-leetcode-api.onrender.com';
    this.username = process.env.LEETCODE_USERNAME;
  }

  async run() {
    console.log('🔍 LeetCode Progress Tracker Diagnostic Tool\n');
    
    if (!this.username) {
      console.error('❌ LEETCODE_USERNAME not set in environment variables');
      return;
    }

    console.log(`👤 Testing user: ${this.username}`);
    console.log(`🌐 API URL: ${this.baseURL}\n`);

    try {
      await this.testApiConnection();
      await this.testSubmissions();
      await this.testProgress();
      await this.testDateLogic();
      
      console.log('\n🎉 Diagnostic completed!');
    } catch (error) {
      console.error('❌ Diagnostic failed:', error.message);
    }
  }

  async testApiConnection() {
    console.log('1. 🔌 Testing API Connection...');
    
    try {
      const response = await axios.get(`${this.baseURL}/${this.username}`, { timeout: 10000 });
      console.log(`✅ API Connection successful`);
      console.log(`   Username: ${response.data.username}`);
      console.log(`   Ranking: ${response.data.ranking}`);
      console.log(`   Problems Solved: ${response.data.totalSolved}\n`);
    } catch (error) {
      console.error(`❌ API Connection failed: ${error.message}`);
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Data: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  async testSubmissions() {
    console.log('2. 📊 Testing Submissions...');
    
    try {
      const response = await axios.get(
        `${this.baseURL}/${this.username}/acSubmission?limit=10`,
        { timeout: 10000 }
      );
      
      console.log(`✅ Submissions API successful`);
      console.log(`   Total Count: ${response.data.count}`);
      console.log(`   Returned: ${response.data.submission?.length || 0} submissions`);
      
      if (response.data.submission && response.data.submission.length > 0) {
        console.log('\n   Recent submissions:');
        response.data.submission.slice(0, 5).forEach((sub, i) => {
          const date = format(new Date(parseInt(sub.timestamp) * 1000), 'yyyy-MM-dd');
          console.log(`   ${i + 1}. ${sub.titleSlug} (${sub.statusDisplay}) - ${date}`);
        });
      }
      console.log('');
    } catch (error) {
      console.error(`❌ Submissions API failed: ${error.message}`);
      throw error;
    }
  }

  async testProgress() {
    console.log('3. 💾 Testing Firebase Progress...');
    
    try {
      const progress = await this.databaseService.loadProgress();
      const settings = await this.databaseService.loadSettings();
      
      console.log(`✅ Firebase connection successful`);
      console.log(`   Last sent date: ${progress.lastSentDate}`);
      console.log(`   Sent problems: ${progress.sentProblems?.length || 0}`);
      console.log(`   Study plan position: ${progress.studyPlanPosition}`);
      console.log(`   Daily problems setting: ${settings.num_questions}`);
      
      if (progress.sentProblems && progress.sentProblems.length > 0) {
        console.log('\n   Current sent problems:');
        progress.sentProblems.forEach((problem, i) => {
          console.log(`   ${i + 1}. ${problem.slug} - solved: ${problem.solved} (sent: ${problem.sentDate})`);
        });
      }
      console.log('');
    } catch (error) {
      console.error(`❌ Firebase test failed: ${error.message}`);
      throw error;
    }
  }

  async testDateLogic() {
    console.log('4. 📅 Testing Date Logic...');
    
    const now = new Date();
    const today = format(now, 'yyyy-MM-dd');
    const yesterday = format(new Date(now.getTime() - 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
    
    console.log(`   Server time: ${now.toISOString()}`);
    console.log(`   Today: ${today}`);
    console.log(`   Yesterday: ${yesterday}`);
    
    try {
      // Test getting submissions for specific dates
      const response = await axios.get(
        `${this.baseURL}/${this.username}/acSubmission?limit=50`,
        { timeout: 10000 }
      );
      
      const yesterdaySubmissions = response.data.submission.filter(s => {
        const submissionDate = format(new Date(parseInt(s.timestamp) * 1000), 'yyyy-MM-dd');
        return submissionDate === yesterday && s.statusDisplay === 'Accepted';
      });
      
      const todaySubmissions = response.data.submission.filter(s => {
        const submissionDate = format(new Date(parseInt(s.timestamp) * 1000), 'yyyy-MM-dd');
        return submissionDate === today && s.statusDisplay === 'Accepted';
      });
      
      console.log(`\n   Yesterday (${yesterday}): ${yesterdaySubmissions.length} accepted submissions`);
      if (yesterdaySubmissions.length > 0) {
        yesterdaySubmissions.forEach(sub => {
          console.log(`     - ${sub.titleSlug} (${sub.statusDisplay})`);
        });
      }
      
      console.log(`   Today (${today}): ${todaySubmissions.length} accepted submissions`);
      if (todaySubmissions.length > 0) {
        todaySubmissions.forEach(sub => {
          console.log(`     - ${sub.titleSlug} (${sub.statusDisplay})`);
        });
      }
      
      console.log('\n✅ Date logic test completed');
    } catch (error) {
      console.error(`❌ Date logic test failed: ${error.message}`);
    }
  }
}

// Run diagnostic if called directly
if (require.main === module) {
  const diagnostic = new DiagnosticTool();
  diagnostic.run().catch(console.error);
}

module.exports = DiagnosticTool; 