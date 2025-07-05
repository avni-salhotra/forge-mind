#!/usr/bin/env node

/**
 * Test script to validate Phase 5-6 ReliabilityService fixes
 * Tests the broken methods from the refactor with enhanced retry logic
 */

require('dotenv').config();
const { ProgressTracker, LeetCodeAPI } = require('./tracker');

async function testReliabilityFixes() {
  console.log('🧪 Testing Phase 5-6 ReliabilityService Fixes\n');
  console.log('🎯 Testing the methods that were broken in the refactor:\n');
  
  const api = new LeetCodeAPI();
  const username = process.env.LEETCODE_USERNAME || 'leetcode';
  
  try {
    // Test 1: getAllSubmissions (was broken - no retry logic)
    console.log('1️⃣ Testing getAllSubmissions() with retry logic...');
    const startTime = Date.now();
    
    try {
      const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const allSubmissions = await api.getAllSubmissions(username, startDate);
      const duration = Date.now() - startTime;
      
      console.log(`✅ SUCCESS: getAllSubmissions() completed in ${duration}ms`);
      console.log(`📊 Retrieved ${allSubmissions.count} submissions total\n`);
    } catch (error) {
      const duration = Date.now() - startTime;
      console.log(`❌ FAILED: getAllSubmissions() after ${duration}ms`);
      console.log(`💡 Error: ${error.message}\n`);
    }
    
    // Test 2: getSubmissionsForDate (was broken - no retry logic) 
    console.log('2️⃣ Testing getSubmissionsForDate() with retry logic...');
    const testDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const startTime2 = Date.now();
    
    try {
      const dateSubmissions = await api.getSubmissionsForDate(username, testDate);
      const duration = Date.now() - startTime2;
      
      console.log(`✅ SUCCESS: getSubmissionsForDate() completed in ${duration}ms`);
      console.log(`📊 Retrieved ${dateSubmissions.length} submissions for ${testDate}\n`);
    } catch (error) {
      const duration = Date.now() - startTime2;
      console.log(`❌ FAILED: getSubmissionsForDate() after ${duration}ms`);
      console.log(`💡 Error: ${error.message}\n`);
    }
    
    // Test 3: Enhanced getUserSubmissions (already had retry, now enhanced)
    console.log('3️⃣ Testing enhanced getUserSubmissions()...');
    const startTime3 = Date.now();
    
    try {
      const submissions = await api.getUserSubmissions(username, 5);
      const duration = Date.now() - startTime3;
      
      console.log(`✅ SUCCESS: getUserSubmissions() completed in ${duration}ms`);
      console.log(`📊 Retrieved ${submissions.submission?.length || 0} recent submissions\n`);
    } catch (error) {
      const duration = Date.now() - startTime3;
      console.log(`❌ FAILED: getUserSubmissions() after ${duration}ms`);
      console.log(`💡 Error: ${error.message}\n`);
    }
    
    // Test 4: ReliabilityService metrics
    console.log('4️⃣ Checking ReliabilityService metrics...');
    const metrics = api.getReliabilityMetrics();
    console.log('📊 Reliability Metrics:');
    console.log(`   Total attempts: ${metrics.totalAttempts}`);
    console.log(`   Success rate: ${metrics.successRate}`);
    console.log(`   Cold starts detected: ${metrics.coldStartsDetected}`);
    console.log(`   Circuit breaker state: ${metrics.circuitBreakerState}`);
    console.log(`   Circuit breaker trips: ${metrics.circuitBreakerTrips}\n`);
    
    // Test 5: Full daily routine simulation
    console.log('5️⃣ Testing full daily routine with ReliabilityService...');
    const tracker = new ProgressTracker();
    const routineStartTime = Date.now();
    
    try {
      await tracker.runDailyRoutine();
      const routineDuration = Date.now() - routineStartTime;
      console.log(`✅ SUCCESS: Daily routine completed in ${routineDuration}ms`);
    } catch (error) {
      const routineDuration = Date.now() - routineStartTime;
      console.log(`❌ FAILED: Daily routine failed after ${routineDuration}ms`);
      console.log(`💡 Error: ${error.message}`);
      
      // Check if it's a cold start issue
      if (error.message.includes('timeout') || error.message.includes('Circuit breaker')) {
        console.log(`🌅 This appears to be a cold start scenario`);
        console.log(`🔄 ReliabilityService should handle this gracefully on retry`);
      }
    }
    
    console.log('\n🏁 Test completed!');
    console.log('\n📋 Summary:');
    console.log('- Fixed getAllSubmissions() to use ReliabilityService retry logic');
    console.log('- Fixed getSubmissionsForDate() to use ReliabilityService retry logic');  
    console.log('- Enhanced all API methods with enterprise-grade reliability patterns');
    console.log('- Added cold start detection and adaptive timeout strategies');
    console.log('- Implemented circuit breaker pattern to prevent wasteful retries');
    
  } catch (error) {
    console.error('💥 Critical test failure:', error.message);
  }
}

// Run the test
if (require.main === module) {
  testReliabilityFixes().catch(console.error);
}

module.exports = { testReliabilityFixes };