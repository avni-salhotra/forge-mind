/**
 * Integration Tests for Phase 3-4 Logic Error Fixes
 * 
 * Tests end-to-end flows to ensure:
 * - Robust timestamp handling preserves UTC/PST logic
 * - Comprehensive validation catches all error cases
 * - Migration system handles schema changes safely
 * - Progress tracking accuracy for ADHD user is maintained
 */

const { DateUtils } = require('./lib/dateUtils');
const { DataValidator, ValidationError } = require('./lib/dataValidator');
const { MigrationService, MigrationError } = require('./lib/migrationService');

/**
 * Test Result Collector
 */
class TestResults {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }

  add(testName, success, message = '', duration = 0) {
    this.tests.push({
      name: testName,
      success,
      message,
      duration,
      timestamp: new Date().toISOString()
    });

    if (success) {
      this.passed++;
      console.log(`✅ ${testName} ${duration ? `(${duration}ms)` : ''}`);
    } else {
      this.failed++;
      console.log(`❌ ${testName}: ${message}`);
    }
  }

  summary() {
    const total = this.passed + this.failed;
    const successRate = total > 0 ? ((this.passed / total) * 100).toFixed(1) : 0;
    
    console.log('\n' + '='.repeat(80));
    console.log('🧪 PHASE 3-4 INTEGRATION TEST SUMMARY');
    console.log('='.repeat(80));
    console.log(`📊 Tests: ${total} total, ${this.passed} passed, ${this.failed} failed`);
    console.log(`📈 Success Rate: ${successRate}%`);
    
    if (this.failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.tests.filter(t => !t.success).forEach(test => {
        console.log(`   - ${test.name}: ${test.message}`);
      });
    }
    
    console.log('\n💡 Test Coverage:');
    console.log('   ✅ Timestamp handling with UTC/PST scenarios');
    console.log('   ✅ Validation framework for all data types');
    console.log('   ✅ Migration system with rollback safety');
    console.log('   ✅ End-to-end progress tracking accuracy');
    
    return {
      total,
      passed: this.passed,
      failed: this.failed,
      successRate: parseFloat(successRate),
      allPassed: this.failed === 0
    };
  }
}

/**
 * Test Suite Runner
 */
class IntegrationTestSuite {
  constructor() {
    this.results = new TestResults();
  }

  /**
   * Run a single test with error handling
   */
  async runTest(testName, testFn) {
    const startTime = Date.now();
    
    try {
      await testFn();
      const duration = Date.now() - startTime;
      this.results.add(testName, true, '', duration);
    } catch (error) {
      const duration = Date.now() - startTime;
      this.results.add(testName, false, error.message, duration);
    }
  }

  /**
   * Test 1: DateUtils timestamp handling preserves existing UTC/PST logic
   */
  async testTimestampHandling() {
    await this.runTest('DateUtils - API timestamp parsing (seconds)', () => {
      // Test existing logic: multiply by 1000 for seconds
      const secondsTimestamp = 1751731800; // July 4, 2025 16:30:00 UTC (corrected to 2025)
      const parsed = DateUtils.parseApiTimestamp(secondsTimestamp, 'test');
      
      if (parsed.getTime() !== secondsTimestamp * 1000) {
        throw new Error(`Expected ${secondsTimestamp * 1000}, got ${parsed.getTime()}`);
      }
    });

    await this.runTest('DateUtils - API timestamp parsing (milliseconds)', () => {
      // Test milliseconds detection
      const msTimestamp = 1751731800000; // July 4, 2025 16:30:00 UTC (corrected to 2025)
      const parsed = DateUtils.parseApiTimestamp(msTimestamp, 'test');
      
      if (parsed.getTime() !== msTimestamp) {
        throw new Error(`Expected ${msTimestamp}, got ${parsed.getTime()}`);
      }
    });

    await this.runTest('DateUtils - Invalid timestamp rejection', () => {
      try {
        DateUtils.parseApiTimestamp('invalid', 'test');
        throw new Error('Should have thrown error for invalid timestamp');
      } catch (error) {
        if (!error.message.includes('not a valid number')) {
          throw new Error(`Wrong error message: ${error.message}`);
        }
      }
    });

    await this.runTest('DateUtils - Future timestamp rejection', () => {
      try {
        const futureTimestamp = Math.floor((Date.now() + (2 * 24 * 60 * 60 * 1000)) / 1000); // 2 days future in seconds
        DateUtils.parseApiTimestamp(futureTimestamp, 'test');
        throw new Error('Should have thrown error for future timestamp');
      } catch (error) {
        if (!error.message.includes('in the future')) {
          throw new Error(`Wrong error message: ${error.message}`);
        }
      }
    });

    await this.runTest('DateUtils - Submission after assignment logic', () => {
      // Test realistic scenario: assignment on one day, submission days later
      const assignmentTime = '2025-07-04'; // Assignment date (start of day)
      const submissionTimestamp = Math.floor(new Date('2025-07-06T14:30:00Z').getTime() / 1000); // Submission 2 days later
      
      const result = DateUtils.isSubmissionAfterAssignment(
        submissionTimestamp, 
        assignmentTime, 
        'test'
      );
      
      if (!result) {
        throw new Error('Should detect submission after assignment even days later');
      }
    });

    await this.runTest('DateUtils - Cross-day edge case', () => {
      // Test edge case: assignment late evening, submission early next morning
      const assignmentTime = '2025-07-04'; // Assignment date
      const submissionTimestamp = Math.floor(new Date('2025-07-05T02:30:00Z').getTime() / 1000); // Next day early morning
      
      const result = DateUtils.isSubmissionAfterAssignment(
        submissionTimestamp, 
        assignmentTime, 
        'cross-day-test'
      );
      
      if (!result) {
        throw new Error('Should handle cross-day submissions correctly');
      }
    });

    await this.runTest('DateUtils - Same day but later submission', () => {
      // Test same day submission (assignment at midnight, submission afternoon)
      const assignmentTime = '2025-07-04'; // Assignment date (00:00:00)
      const submissionTimestamp = Math.floor(new Date('2025-07-04T16:30:00Z').getTime() / 1000); // Same day afternoon
      
      const result = DateUtils.isSubmissionAfterAssignment(
        submissionTimestamp, 
        assignmentTime, 
        'same-day-test'
      );
      
      if (!result) {
        throw new Error('Should detect same-day submissions after assignment');
      }
    });

    await this.runTest('DateUtils - Submission before assignment rejection', () => {
      // Test that submissions before assignment are correctly rejected
      const assignmentTime = '2025-07-04'; // Assignment date
      const submissionTimestamp = Math.floor(new Date('2025-07-03T14:30:00Z').getTime() / 1000); // Day before
      
      const result = DateUtils.isSubmissionAfterAssignment(
        submissionTimestamp, 
        assignmentTime, 
        'before-assignment-test'
      );
      
      if (result) {
        throw new Error('Should reject submissions before assignment');
      }
    });
  }

  /**
   * Test 2: Validation framework catches all error cases
   */
  async testValidationFramework() {
    await this.runTest('Validator - Valid settings update', () => {
      const validSettings = { num_questions: 3, email_enabled: true };
      DataValidator.validate(validSettings, 'settings-update', 'test');
    });

    await this.runTest('Validator - Invalid settings rejection', () => {
      try {
        const invalidSettings = { num_questions: 15 }; // > 10
        DataValidator.validate(invalidSettings, 'settings-update', 'test');
        throw new Error('Should have rejected invalid settings');
      } catch (error) {
        if (!(error instanceof ValidationError)) {
          throw new Error(`Wrong error type: ${error.constructor.name}`);
        }
      }
    });

    await this.runTest('Validator - Valid progress data', () => {
      const validProgress = {
        lastSentDate: '2025-07-04',
        sentProblems: [{
          slug: 'two-sum',
          solved: false,
          sentDate: '2025-07-04'
        }],
        studyPlanPosition: 1,
        pendingQueue: [],
        settingsAtSendTime: { num_questions: 1, timestamp: null }
      };
      
      DataValidator.validate(validProgress, 'progress-data', 'test');
    });

    await this.runTest('Validator - Invalid progress rejection', () => {
      try {
        const invalidProgress = {
          lastSentDate: 'not-a-date',
          sentProblems: 'not-an-array',
          studyPlanPosition: -1 // Invalid
        };
        
        DataValidator.validate(invalidProgress, 'progress-data', 'test');
        throw new Error('Should have rejected invalid progress');
      } catch (error) {
        if (!(error instanceof ValidationError)) {
          throw new Error(`Wrong error type: ${error.constructor.name}`);
        }
      }
    });

    await this.runTest('Validator - Safe validation no-throw', () => {
      const invalidData = { invalid: 'data' };
      const result = DataValidator.validateSafe(invalidData, 'progress-data', 'test');
      
      if (result.success) {
        throw new Error('Safe validation should have failed');
      }
      
      if (!result.error || !result.error.message) {
        throw new Error('Safe validation should return error details');
      }
    });
  }

  /**
   * Test 3: Migration system handles schema changes safely
   */
  async testMigrationSystem() {
    // Create mock database service for testing
    const mockDb = {
      loadProgress: () => Promise.resolve({}),
      saveProgress: () => Promise.resolve(),
      loadSettings: () => Promise.resolve({})
    };
    
    const migrationService = new MigrationService(mockDb);

    await this.runTest('Migration - Version detection V1 legacy', () => {
      const legacyData = {
        lastSlug: 'two-sum',
        lastSentDate: '2025-07-04',
        solved: false
      };
      
      const version = migrationService.detectVersion(legacyData);
      if (version !== '1.0.0') {
        throw new Error(`Expected 1.0.0, got ${version}`);
      }
    });

    await this.runTest('Migration - Version detection V2 modern', () => {
      const modernData = {
        sentProblems: [],
        studyPlanPosition: 0,
        lastSentDate: null
      };
      
      const version = migrationService.detectVersion(modernData);
      if (version !== '2.0.0') {
        throw new Error(`Expected 2.0.0, got ${version}`);
      }
    });

    await this.runTest('Migration - V1 to V2 conversion', async () => {
      const legacyData = {
        lastSlug: 'two-sum',
        lastSentDate: '2025-07-04',
        solved: true
      };
      
      const result = await migrationService.migrateSafe(legacyData, '2.0.0', 'test');
      
      if (!result.success) {
        throw new Error(`Migration failed: ${result.error?.message}`);
      }
      
      if (!result.data.sentProblems || result.data.sentProblems.length !== 1) {
        throw new Error('Migration should create sentProblems array');
      }
      
      if (result.data.sentProblems[0].slug !== 'two-sum') {
        throw new Error('Migration should preserve slug');
      }
    });

    await this.runTest('Migration - Safe migration with rollback', async () => {
      // Test with data that should actually fail validation during migration
      const badData = {
        lastSlug: 'two-sum',
        lastSentDate: 'invalid-date-format', // This will cause validation to fail
        solved: 'not-a-boolean' // Invalid data type
      };
      
      const result = await migrationService.migrateSafe(badData, '2.2.0', 'test');
      
      // Migration should fail due to validation errors
      if (result.success) {
        throw new Error('Migration should have failed with invalid date format');
      }
      
      if (!result.error || !result.error.message) {
        throw new Error('Should return error details');
      }
      
      // Verify we get the original data back as fallback
      if (!result.data) {
        throw new Error('Should return fallback data on failure');
      }
    });

    await this.runTest('Migration - Status reporting', () => {
      const legacyData = { lastSlug: 'test' };
      const status = migrationService.getStatus(legacyData);
      
      if (!status.needsMigration) {
        throw new Error('Should detect migration need for legacy data');
      }
      
      if (!status.isLegacy) {
        throw new Error('Should detect legacy format');
      }
      
      if status.recommendations.length === 0) {
        throw new Error('Should provide recommendations');
      }
    });
  }

  /**
   * Test 4: End-to-end progress tracking accuracy simulation
   */
  async testProgressTrackingAccuracy() {
    await this.runTest('Progress Tracking - Assignment date validation', () => {
      const today = DateUtils.getTodayString();
      const isValid = DateUtils.isValidAssignmentDate(today, 'test');
      
      if (!isValid) {
        throw new Error("Today's date should be valid assignment date");
      }
    });

    await this.runTest('Progress Tracking - Problem solved detection', () => {
      // Simulate: problem assigned yesterday, submitted today
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const yesterdayStr = DateUtils.formatDateString(yesterday);
      const todayTimestamp = Math.floor(Date.now() / 1000); // API format
      
      const isSolved = DateUtils.isSubmissionAfterAssignment(
        todayTimestamp,
        yesterdayStr,
        'test'
      );
      
      if (!isSolved) {
        throw new Error('Should detect problem solved after assignment');
      }
    });

    await this.runTest('Progress Tracking - Complex validation scenario', () => {
      // Simulate complete progress data with multiple problems
      const progressData = {
        lastSentDate: DateUtils.getTodayString(),
        sentProblems: [
          {
            slug: 'two-sum',
            solved: true,
            sentDate: '2025-07-03',
            solvedTimestamp: '2025-07-04T10:30:00Z'
          },
          {
            slug: 'add-two-numbers',
            solved: false,
            sentDate: DateUtils.getTodayString()
          }
        ],
        studyPlanPosition: 2,
        pendingQueue: [],
        settingsAtSendTime: {
          num_questions: 2,
          timestamp: new Date().toISOString()
        },
        version: '2.2.0'
      };
      
      // This should pass comprehensive validation
      DataValidator.validate(progressData, 'progress-data', 'test');
      
      // Verify timestamp logic works for solved problem
      const solvedProblem = progressData.sentProblems[0];
      const isSolved = DateUtils.isSubmissionAfterAssignment(
        solvedProblem.solvedTimestamp,
        solvedProblem.sentDate,
        'test'
      );
      
      if (!isSolved) {
        throw new Error('Should detect solved problem correctly');
      }
    });

    await this.runTest('Progress Tracking - Timezone edge case', () => {
      // Test edge case: assignment at 11 PM PST, submission at 1 AM PST next day
      const pstAssignment = '2025-07-04T07:00:00Z'; // 11 PM PST prev day
      const pstSubmission = '2025-07-04T09:00:00Z'; // 1 AM PST next day
      
      const isSolved = DateUtils.isSubmissionAfterAssignment(
        pstSubmission,
        pstAssignment,
        'timezone-edge'
      );
      
      if (!isSolved) {
        throw new Error('Should handle PST timezone edge case correctly');
      }
    });
  }

  /**
   * Test 5: Error handling and recovery scenarios
   */
  async testErrorHandlingScenarios() {
    await this.runTest('Error Handling - Graceful validation degradation', () => {
      // Test that system continues with warnings for non-critical issues
      const progressWithWarnings = {
        lastSentDate: '2025-07-04',
        sentProblems: [{
          slug: 'unusual-slug-format!!!', // Unusual but not critical
          solved: false,
          sentDate: '2025-07-04'
        }],
        studyPlanPosition: 1,
        pendingQueue: [],
        settingsAtSendTime: { num_questions: 1 }
      };
      
      // Should pass with warnings, not fail
      const result = DataValidator.validateSafe(progressWithWarnings, 'progress-data', 'test');
      
      if (!result.success) {
        throw new Error('Should pass with warnings for unusual but valid data');
      }
    });

    await this.runTest('Error Handling - Critical validation failure', () => {
      // Test that system fails fast for critical issues
      const criticallyBadProgress = {
        lastSentDate: null,
        sentProblems: null, // Critical: should be array
        studyPlanPosition: 'not-a-number' // Critical: should be number
      };
      
      const result = DataValidator.validateSafe(criticallyBadProgress, 'progress-data', 'test');
      
      if (result.success) {
        throw new Error('Should fail for critically invalid data');
      }
    });

    await this.runTest('Error Handling - Safe date parsing fallback', () => {
      const fallbackDate = new Date('2025-07-04');
      const result = DateUtils.safeDateParse('invalid-date', fallbackDate, 'test');
      
      if (result.getTime() !== fallbackDate.getTime()) {
        throw new Error('Should use fallback for invalid date');
      }
    });
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    console.log('🚀 Starting Phase 3-4 Integration Tests...\n');
    
    console.log('📅 Testing DateUtils timestamp handling...');
    await this.testTimestampHandling();
    
    console.log('\n🔍 Testing validation framework...');
    await this.testValidationFramework();
    
    console.log('\n🔄 Testing migration system...');
    await this.testMigrationSystem();
    
    console.log('\n📊 Testing progress tracking accuracy...');
    await this.testProgressTrackingAccuracy();
    
    console.log('\n⚠️ Testing error handling scenarios...');
    await this.testErrorHandlingScenarios();
    
    return this.results.summary();
  }
}

/**
 * CLI Runner
 */
async function main() {
  const testSuite = new IntegrationTestSuite();
  
  try {
    const results = await testSuite.runAllTests();
    
    if (results.allPassed) {
      console.log('\n🎉 ALL TESTS PASSED! Phase 3-4 implementation is solid.');
      console.log('✅ Ready for production deployment with confidence.');
      process.exit(0);
    } else {
      console.log('\n⚠️ Some tests failed. Review and fix before deployment.');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n💥 Test suite failed to run:', error.message);
    process.exit(1);
  }
}

// Export for use in other files
module.exports = {
  IntegrationTestSuite,
  TestResults
};

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}