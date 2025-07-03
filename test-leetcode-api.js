const axios = require('axios');

/**
 * Test Script for alfa-leetcode-api
 * 
 * This script tests all the key endpoints we need for the LeetCode tracker project:
 * 1. User profile data
 * 2. Submission history (crucial for historical data import)
 * 3. Individual problem details
 * 4. Problem search functionality
 * 5. Contest data (if needed)
 */

// Switch between hosted, local, and production API
const USE_LOCAL_API = process.env.USE_LOCAL_API === 'true';
const BASE_URL = USE_LOCAL_API 
  ? 'http://localhost:3000'
  : process.env.LEETCODE_API_URL;

if (!BASE_URL) {
  console.error('Error: LEETCODE_API_URL environment variable must be set when not using local API');
  process.exit(1);
}

// Test configuration
const TEST_CONFIG = {
  // Test with actual user account for real data validation
  testUsername: 'avnisalhotra', // Real user account
  testProblemSlug: 'two-sum', // Very common problem
  testProblemTitle: 'Two Sum',
  timeout: 10000 // 10 second timeout
};

/**
 * API Test Results
 */
let testResults = {
  userProfile: { success: false, data: null, error: null, responseTime: 0 },
  userSubmissions: { success: false, data: null, error: null, responseTime: 0 },
  problemDetails: { success: false, data: null, error: null, responseTime: 0 },
  dailyChallenge: { success: false, data: null, error: null, responseTime: 0 },
  searchProblem: { success: false, data: null, error: null, responseTime: 0 }
};

/**
 * Helper function to make API calls with timing
 */
async function makeApiCall(url, testName) {
  const startTime = Date.now();
  try {
    console.log(`\n🧪 Testing: ${testName}`);
    console.log(`📡 URL: ${url}`);
    
    const response = await axios.get(url, { timeout: TEST_CONFIG.timeout });
    const endTime = Date.now();
    const responseTime = endTime - startTime;
    
    console.log(`✅ Success! Response time: ${responseTime}ms`);
    console.log(`📊 Status: ${response.status}`);
    console.log(`📦 Data preview:`, JSON.stringify(response.data, null, 2).substring(0, 500) + '...');
    
    return {
      success: true,
      data: response.data,
      error: null,
      responseTime
    };
  } catch (error) {
    const endTime = Date.now();
    const responseTime = endTime - startTime;
    
    console.log(`❌ Failed! Response time: ${responseTime}ms`);
    console.log(`💥 Error:`, error.message);
    
    if (error.response) {
      console.log(`📊 Status: ${error.response.status}`);
      console.log(`📝 Response:`, error.response.data);
    }
    
    return {
      success: false,
      data: null,
      error: error.message,
      responseTime
    };
  }
}

/**
 * Test 1: User Profile Data
 * Critical for: User stats, streak calculation, overall progress
 */
async function testUserProfile() {
  const url = `${BASE_URL}/${TEST_CONFIG.testUsername}`;
  testResults.userProfile = await makeApiCall(url, 'User Profile');
  
  if (testResults.userProfile.success) {
    const data = testResults.userProfile.data;
    console.log(`👤 Username: ${data.username || 'N/A'}`);
    console.log(`🏆 Ranking: ${data.ranking || 'N/A'}`);
    console.log(`📈 Total Solved: ${data.totalSolved || 'N/A'}`);
    console.log(`🔥 Badges: ${data.badges?.length || 0}`);
  }
}

/**
 * Test 2: User Submissions (Most Critical!)
 * Critical for: Historical data import, progress tracking, streak calculation
 */
async function testUserSubmissions() {
  const url = `${BASE_URL}/${TEST_CONFIG.testUsername}/acSubmission?limit=20`;
  testResults.userSubmissions = await makeApiCall(url, 'User Submissions (Accepted)');
  
  if (testResults.userSubmissions.success) {
    const data = testResults.userSubmissions.data;
    console.log(`📝 Total Submissions: ${data.count || 'N/A'}`);
    console.log(`📚 Submissions returned: ${data.submission?.length || 0}`);
    
    if (data.submission && data.submission.length > 0) {
      const firstSubmission = data.submission[0];
      console.log(`🔍 Sample submission:`, {
        title: firstSubmission.title,
        titleSlug: firstSubmission.titleSlug,
        timestamp: firstSubmission.timestamp,
        statusDisplay: firstSubmission.statusDisplay,
        lang: firstSubmission.lang
      });
    }
  }
}

/**
 * Test 3: Problem Details
 * Critical for: Problem metadata, difficulty, tags, description
 */
async function testProblemDetails() {
  const url = `${BASE_URL}/select?titleSlug=${TEST_CONFIG.testProblemSlug}`;
  testResults.problemDetails = await makeApiCall(url, 'Problem Details');
  
  if (testResults.problemDetails.success) {
    const data = testResults.problemDetails.data;
    console.log(`📝 Title: ${data.questionTitle || 'N/A'}`);
    console.log(`⚡ Difficulty: ${data.difficulty || 'N/A'}`);
    console.log(`🏷️ Topic Tags: ${data.topicTags?.map(t => t.name).join(', ') || 'N/A'}`);
    console.log(`🔗 LeetCode URL: https://leetcode.com/problems/${data.questionTitleSlug || 'N/A'}/`);
  }
}

/**
 * Test 4: Daily Challenge
 * Optional but useful for: Daily problem suggestions
 */
async function testDailyChallenge() {
  const url = `${BASE_URL}/daily`;
  testResults.dailyChallenge = await makeApiCall(url, 'Daily Challenge');
  
  if (testResults.dailyChallenge.success) {
    const data = testResults.dailyChallenge.data;
    console.log(`📅 Today's Challenge: ${data.questionTitle || 'N/A'}`);
    console.log(`⚡ Difficulty: ${data.difficulty || 'N/A'}`);
    console.log(`🔗 Problem Slug: ${data.questionTitleSlug || 'N/A'}`);
  }
}

/**
 * Test 5: Problem Search (for Trello integration)
 * Critical for: Mapping Trello card names to LeetCode problems
 */
async function testProblemSearch() {
  // Note: This endpoint might not exist, but let's test common search patterns
  const searchTerms = [TEST_CONFIG.testProblemTitle, 'Array', 'Two'];
  
  for (const term of searchTerms) {
    const url = `${BASE_URL}/problems?search=${encodeURIComponent(term)}`;
    console.log(`\n🔍 Testing search for: "${term}"`);
    
    try {
      const result = await makeApiCall(url, `Problem Search: "${term}"`);
      if (result.success) {
        testResults.searchProblem = result;
        break;
      }
    } catch (error) {
      console.log(`🔍 Search endpoint not available for term: "${term}"`);
    }
  }
}

/**
 * Test Summary and Recommendations
 */
function printTestSummary() {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 ALFA-LEETCODE-API TEST SUMMARY');
  console.log('='.repeat(80));
  
  const tests = [
    { name: 'User Profile', result: testResults.userProfile, critical: true },
    { name: 'User Submissions', result: testResults.userSubmissions, critical: true },
    { name: 'Problem Details', result: testResults.problemDetails, critical: true },
    { name: 'Daily Challenge', result: testResults.dailyChallenge, critical: false },
    { name: 'Problem Search', result: testResults.searchProblem, critical: false }
  ];
  
  let criticalPassed = 0;
  let criticalTotal = 0;
  let totalPassed = 0;
  
  tests.forEach(test => {
    const status = test.result.success ? '✅ PASS' : '❌ FAIL';
    const critical = test.critical ? '🔥 CRITICAL' : '📋 OPTIONAL';
    const time = test.result.responseTime ? `${test.result.responseTime}ms` : 'N/A';
    
    console.log(`${status} ${critical} ${test.name.padEnd(20)} (${time})`);
    
    if (test.result.success) totalPassed++;
    if (test.critical) {
      criticalTotal++;
      if (test.result.success) criticalPassed++;
    }
    
    if (!test.result.success && test.result.error) {
      console.log(`   💥 Error: ${test.result.error}`);
    }
  });
  
  console.log('\n' + '-'.repeat(80));
  console.log(`📊 RESULTS: ${totalPassed}/${tests.length} tests passed`);
  console.log(`🔥 CRITICAL: ${criticalPassed}/${criticalTotal} critical tests passed`);
  
  // Project viability assessment
  console.log('\n' + '🚀 PROJECT VIABILITY ASSESSMENT'.padEnd(80));
  console.log('-'.repeat(80));
  
  if (criticalPassed === criticalTotal) {
    console.log('✅ PROJECT IS VIABLE! All critical API endpoints are working.');
    console.log('   You can proceed with the LeetCode tracker project as planned.');
    
    if (testResults.userSubmissions.success) {
      const submissionData = testResults.userSubmissions.data;
      console.log(`   📈 Historical data import possible: ${submissionData.count || 'Unknown'} submissions available`);
    }
    
    console.log('\n📋 NEXT STEPS:');
    console.log('   1. Choose a LeetCode username to track');
    console.log('   2. Test with your actual username');
    console.log('   3. Begin Phase 1 of the roadmap');
    console.log('   4. Set up Trello integration in parallel');
    
  } else {
    console.log('⚠️  PROJECT NEEDS RESCOPING! Critical API endpoints are failing.');
    console.log('   Consider these alternatives:');
    console.log('   - Manual data entry instead of API integration');
    console.log('   - Web scraping (check ToS compliance)');
    console.log('   - Focus only on Trello-based tracking');
    console.log('   - Find alternative LeetCode APIs');
  }
  
  // Performance assessment
  const avgResponseTime = tests
    .filter(t => t.result.success)
    .reduce((sum, t) => sum + t.result.responseTime, 0) / 
    tests.filter(t => t.result.success).length;
    
  if (avgResponseTime) {
    console.log(`\n⚡ PERFORMANCE: Average response time ${avgResponseTime.toFixed(0)}ms`);
    if (avgResponseTime > 5000) {
      console.log('   ⚠️  API is slow - consider caching strategies');
    } else if (avgResponseTime < 2000) {
      console.log('   🚀 API is fast - good for real-time features');
    }
  }
}

/**
 * Main test execution
 */
async function runAllTests() {
  console.log('🚀 Starting alfa-leetcode-api validation tests...\n');
  console.log(`🎯 Testing against: ${BASE_URL}`);
  const apiStatus = USE_LOCAL_API 
    ? 'Local (localhost:3000)' 
    : 'Production';
  console.log(`🏠 API Environment: ${apiStatus}`);
  console.log(`👤 Test username: ${TEST_CONFIG.testUsername}`);
  console.log(`📝 Test problem: ${TEST_CONFIG.testProblemSlug}`);
  
  try {
    await testUserProfile();
    await testUserSubmissions();
    await testProblemDetails();
    await testDailyChallenge();
    await testProblemSearch();
    
    printTestSummary();
    
  } catch (error) {
    console.log('\n💥 FATAL ERROR during testing:', error.message);
    console.log('⚠️  Cannot proceed with API validation');
  }
}

// === NEW HELPER: QUICK SUBMISSION CHECK =====================================
// Usage (example):
//    node test-leetcode-api.js --date=2025-07-02 --slug=two-sum
// ---------------------------------------------------------------------------
async function checkSubmissionOnDate({ username, slug, date }) {
  const limit = 100; // pull the most-recent 100 accepted submissions
  const url = `${BASE_URL}/${username}/acSubmission?limit=${limit}`;

  console.log(`\n🔍 Looking for \`${slug}\` in ${username}'s accepted submissions on ${date}`);
  console.log(`📡 Fetching: ${url}`);

  try {
    const res = await axios.get(url, { timeout: TEST_CONFIG.timeout });
    const submissions = Array.isArray(res.data.submission) ? res.data.submission : [];
    console.log(`✅ Received ${submissions.length} submissions (API count: ${res.data.count})`);

    // UTC midnight boundaries for the target date
    const startTs = Date.parse(`${date}T00:00:00Z`);
    const endTs   = startTs + 24 * 60 * 60 * 1000;

    const hits = submissions.filter(s => {
      const tsMs = Number(s.timestamp) * 1000;
      const inWindow = tsMs >= startTs && tsMs < endTs;
      const isAccepted = (s.statusDisplay || '').toLowerCase() === 'accepted';
      const slugMatch  = s.titleSlug === slug;
      return inWindow && isAccepted && slugMatch;
    });

    if (hits.length > 0) {
      console.log(`🎉 FOUND! ${slug} was accepted ${hits.length} time(s) on ${date}.`);
    } else {
      console.log(`❌ Not found. Either the submission isn't within the latest ${limit} accepted entries, or it wasn't accepted on ${date}.`);
    }
  } catch (err) {
    console.error(`💥 Failed to query submissions: ${err.message}`);
    if (err.response) {
      console.error('   Response status:', err.response.status);
      console.error('   Response data:', err.response.data);
    }
  }
}

// --------------------------- CLI ENTRY -------------------------------------
if (require.main === module) {
  const argv = process.argv.slice(2);

  // Quick date check mode ----------------------------------------------------
  const dateArg = argv.find(a => a.startsWith('--date='));
  const slugArg = argv.find(a => a.startsWith('--slug='));
  if (dateArg && slugArg) {
    const date = dateArg.split('=')[1];
    const slug = slugArg.split('=')[1];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      console.error('❌ Date must be in YYYY-MM-DD format');
      process.exit(1);
    }
    checkSubmissionOnDate({ username: TEST_CONFIG.testUsername, slug, date })
      .catch(console.error);
    return;
  }

  // Default full test suite --------------------------------------------------
  runAllTests().catch(console.error);
}

module.exports = {
  runAllTests,
  testResults,
  TEST_CONFIG
};