#!/usr/bin/env node

require('dotenv').config();
const { format } = require('date-fns');
const { databaseService } = require('./lib/firebase');

async function simulateTomorrow() {
  console.log('🧪 Simulating tomorrow\'s daily routine...\n');

  try {
    // Load current progress
    const progress = await databaseService.loadProgress();
    const settings = await databaseService.loadSettings();
    
    console.log('📊 Current state:');
    console.log(`  Last sent: ${progress.lastSentDate}`);
    console.log(`  Study plan position: ${progress.studyPlanPosition}`);
    console.log(`  Sent problems: ${progress.sentProblems.length}`);
    
    progress.sentProblems.forEach((problem, i) => {
      console.log(`    ${i + 1}. ${problem.slug} - solved: ${problem.solved}`);
    });
    
    // Update last sent date to yesterday to trigger tomorrow's routine
    const yesterday = format(new Date(Date.now() - 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
    progress.lastSentDate = yesterday;
    
    console.log(`\n🔄 Setting lastSentDate to ${yesterday} to simulate tomorrow's run...`);
    await databaseService.saveProgress(progress);
    
    console.log('✅ Ready for tomorrow simulation!\n');
    console.log('💡 Now run: node tracker.js check');
    console.log('💡 This should advance to the next problem since two-sum is solved');
    
  } catch (error) {
    console.error('❌ Simulation setup failed:', error.message);
  }
}

if (require.main === module) {
  simulateTomorrow().catch(console.error);
}

module.exports = { simulateTomorrow }; 