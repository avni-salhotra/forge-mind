#!/usr/bin/env node

/**
 * Test Multi-Problem Logic
 * 
 * Comprehensive tests for the new multi-problem functionality
 * including edge cases and migration scenarios.
 */

const fs = require('fs');
const path = require('path');

// Import our modules
const { StudyPlanHelper } = require('./study-plan');

// Test data setup
const TEST_PROGRESS_PATH = path.join(__dirname, 'test-progress.json');
const TEST_SETTINGS_PATH = path.join(__dirname, 'test-settings.json');

// Copy the logic from tracker.js for testing
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

function validateNumQuestions(num) {
  const parsed = parseInt(num);
  if (isNaN(parsed) || parsed < 1) return 1;
  if (parsed > 10) return 10;
  return parsed;
}

function calculateTodaysProblems(progress, settings) {
  const numQuestions = validateNumQuestions(settings.num_questions);
  const orderedProblems = StudyPlanHelper.getOrderedProblemList();
  
  // Get unfinished problems from yesterday
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
      // More pending than we can send
      result.problems = allPending.slice(0, numQuestions);
      result.unfinished = result.problems;
      result.updatedPendingQueue = allPending.slice(numQuestions);
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

// Test Cases
const tests = [
  {
    name: "Happy Path - All Complete",
    progress: {
      ...DEFAULT_PROGRESS,
      lastSentDate: "2025-06-26",
      sentProblems: [
        { slug: "two-sum", solved: true, sentDate: "2025-06-26" },
        { slug: "add-two-numbers", solved: true, sentDate: "2025-06-26" },
        { slug: "longest-substring", solved: true, sentDate: "2025-06-26" }
      ],
      studyPlanPosition: 3
    },
    settings: { num_questions: 3 },
    expected: {
      problemsCount: 3,
      unfinishedCount: 0,
      newProblemsCount: 3,
      updatedPosition: 6
    }
  },
  
  {
    name: "Partial Completion",
    progress: {
      ...DEFAULT_PROGRESS,
      lastSentDate: "2025-06-26",
      sentProblems: [
        { slug: "two-sum", solved: true, sentDate: "2025-06-26" },
        { slug: "add-two-numbers", solved: false, sentDate: "2025-06-26" },
        { slug: "longest-substring", solved: true, sentDate: "2025-06-26" }
      ],
      studyPlanPosition: 3
    },
    settings: { num_questions: 3 },
    expected: {
      problemsCount: 3,
      unfinishedCount: 1,
      newProblemsCount: 2,
      updatedPosition: 5
    }
  },
  
  {
    name: "Zero Completion",
    progress: {
      ...DEFAULT_PROGRESS,
      lastSentDate: "2025-06-26",
      sentProblems: [
        { slug: "two-sum", solved: false, sentDate: "2025-06-26" },
        { slug: "add-two-numbers", solved: false, sentDate: "2025-06-26" },
        { slug: "longest-substring", solved: false, sentDate: "2025-06-26" }
      ],
      studyPlanPosition: 3
    },
    settings: { num_questions: 3 },
    expected: {
      problemsCount: 3,
      unfinishedCount: 3,
      newProblemsCount: 0,
      updatedPosition: 3 // No advancement
    }
  },
  
  {
    name: "Settings Increase (3→5 with 2 unfinished)",
    progress: {
      ...DEFAULT_PROGRESS,
      lastSentDate: "2025-06-26",
      sentProblems: [
        { slug: "two-sum", solved: true, sentDate: "2025-06-26" },
        { slug: "add-two-numbers", solved: false, sentDate: "2025-06-26" },
        { slug: "longest-substring", solved: false, sentDate: "2025-06-26" }
      ],
      studyPlanPosition: 3
    },
    settings: { num_questions: 5 },
    expected: {
      problemsCount: 5,
      unfinishedCount: 2,
      newProblemsCount: 3,
      updatedPosition: 6
    }
  },
  
  {
    name: "Settings Decrease (5→2 with 4 unfinished)",
    progress: {
      ...DEFAULT_PROGRESS,
      lastSentDate: "2025-06-26",
      sentProblems: [
        { slug: "problem-a", solved: false, sentDate: "2025-06-26" },
        { slug: "problem-b", solved: false, sentDate: "2025-06-26" },
        { slug: "problem-c", solved: false, sentDate: "2025-06-26" },
        { slug: "problem-d", solved: false, sentDate: "2025-06-26" }
      ],
      studyPlanPosition: 4
    },
    settings: { num_questions: 2 },
    expected: {
      problemsCount: 2,
      unfinishedCount: 2,
      newProblemsCount: 0,
      updatedPosition: 4,
      pendingQueueCount: 2
    }
  },
  
  {
    name: "With Pending Queue",
    progress: {
      ...DEFAULT_PROGRESS,
      lastSentDate: "2025-06-26",
      sentProblems: [
        { slug: "current-a", solved: false, sentDate: "2025-06-26" }
      ],
      pendingQueue: ["queued-a", "queued-b"],
      studyPlanPosition: 5
    },
    settings: { num_questions: 4 },
    expected: {
      problemsCount: 4,
      unfinishedCount: 3, // 1 current + 2 queued
      newProblemsCount: 1,
      updatedPosition: 6
    }
  },
  
  {
    name: "Validation - Invalid num_questions",
    progress: DEFAULT_PROGRESS,
    settings: { num_questions: 15 }, // Above max
    expected: {
      effectiveNumQuestions: 10 // Should be clamped
    }
  },
  
  {
    name: "Edge Case - Zero num_questions",
    progress: DEFAULT_PROGRESS,
    settings: { num_questions: 0 },
    expected: {
      effectiveNumQuestions: 1 // Should be minimum
    }
  }
];

// Run Tests
function runTests() {
  console.log('🧪 Running Multi-Problem Logic Tests\n');
  
  let passed = 0;
  let failed = 0;
  
  tests.forEach((test, index) => {
    console.log(`${index + 1}. ${test.name}`);
    
    try {
      const result = calculateTodaysProblems(test.progress, test.settings);
      
      let testPassed = true;
      const errors = [];
      
      // Check expected values
      if (test.expected.problemsCount !== undefined && result.problems.length !== test.expected.problemsCount) {
        errors.push(`Expected ${test.expected.problemsCount} problems, got ${result.problems.length}`);
        testPassed = false;
      }
      
      if (test.expected.unfinishedCount !== undefined && result.unfinished.length !== test.expected.unfinishedCount) {
        errors.push(`Expected ${test.expected.unfinishedCount} unfinished, got ${result.unfinished.length}`);
        testPassed = false;
      }
      
      if (test.expected.newProblemsCount !== undefined && result.newProblems.length !== test.expected.newProblemsCount) {
        errors.push(`Expected ${test.expected.newProblemsCount} new problems, got ${result.newProblems.length}`);
        testPassed = false;
      }
      
      if (test.expected.updatedPosition !== undefined && result.updatedPosition !== test.expected.updatedPosition) {
        errors.push(`Expected position ${test.expected.updatedPosition}, got ${result.updatedPosition}`);
        testPassed = false;
      }
      
      if (test.expected.pendingQueueCount !== undefined && result.updatedPendingQueue.length !== test.expected.pendingQueueCount) {
        errors.push(`Expected ${test.expected.pendingQueueCount} pending, got ${result.updatedPendingQueue.length}`);
        testPassed = false;
      }
      
      if (test.expected.effectiveNumQuestions !== undefined) {
        const effective = validateNumQuestions(test.settings.num_questions);
        if (effective !== test.expected.effectiveNumQuestions) {
          errors.push(`Expected effective num_questions ${test.expected.effectiveNumQuestions}, got ${effective}`);
          testPassed = false;
        }
      }
      
      if (testPassed) {
        console.log('   ✅ PASSED');
        passed++;
      } else {
        console.log('   ❌ FAILED');
        errors.forEach(error => console.log(`      - ${error}`));
        failed++;
      }
      
      // Show result details for debugging
      if (!testPassed || process.env.VERBOSE) {
        console.log(`      Result: ${result.problems.length} problems (${result.unfinished.length} unfinished, ${result.newProblems.length} new)`);
        console.log(`      Position: ${result.updatedPosition}, Pending: ${result.updatedPendingQueue.length}`);
      }
      
    } catch (error) {
      console.log('   💥 ERROR:', error.message);
      failed++;
    }
    
    console.log('');
  });
  
  console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log('🎉 All tests passed! Multi-problem logic is working correctly.\n');
  } else {
    console.log('⚠️ Some tests failed. Please review the logic.\n');
    process.exit(1);
  }
}

// Migration Test
function testMigration() {
  console.log('🔄 Testing Migration Logic\n');
  
  // Simulate old format
  const oldProgress = {
    lastSentDate: "2025-06-26",
    lastSlug: "two-sum",
    solved: false
  };
  
  console.log('Old format:', JSON.stringify(oldProgress, null, 2));
  
  // Simulate migration (simplified version)
  const orderedProblems = StudyPlanHelper.getOrderedProblemList();
  let studyPlanPosition = 0;
  
  if (oldProgress.lastSlug) {
    const currentIndex = orderedProblems.findIndex(p => p.slug === oldProgress.lastSlug);
    studyPlanPosition = currentIndex !== -1 ? currentIndex : 0;
  }
  
  const migratedProgress = {
    lastSentDate: oldProgress.lastSentDate,
    sentProblems: oldProgress.lastSlug ? [{
      slug: oldProgress.lastSlug,
      solved: oldProgress.solved || false,
      sentDate: oldProgress.lastSentDate
    }] : [],
    studyPlanPosition: studyPlanPosition,
    pendingQueue: [],
    settingsAtSendTime: {
      num_questions: 1,
      timestamp: oldProgress.lastSentDate
    }
  };
  
  console.log('Migrated format:', JSON.stringify(migratedProgress, null, 2));
  console.log('✅ Migration test completed!\n');
}

// Run all tests
if (require.main === module) {
  runTests();
  testMigration();
} 