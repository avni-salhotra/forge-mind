/**
 * LeetCode Study Plan Configuration
 * 
 * This file contains your structured study plan with weekly goals.
 * Each week has a theme/topic and specific problems to complete.
 */

// Load environment variables
require('dotenv').config();

// Load generated study plan weeks from JSON file (created via parse-trello.js)
const { weeks } = require('./study-plan.clean.json');

// Convert weeks -> topics (merge duplicate themes, preserve order)
const topics = [];
const topicIndex = new Map();
Object.keys(weeks).sort((a,b)=>a-b).forEach(weekNo=>{
  const week = weeks[weekNo];
  const theme = week.theme || `Theme ${weekNo}`;
  let tIdx = topicIndex.get(theme);
  if(tIdx===undefined){
    tIdx = topics.length;
    topics.push({ name: theme, problems: []});
    topicIndex.set(theme,tIdx);
  }
  topics[tIdx].problems.push(...week.problems);
});

const STUDY_PLAN = {
  // Study plan metadata
  startDate: process.env.STUDY_PLAN_START_DATE || '2025-01-27',
  username: process.env.LEETCODE_USERNAME || 'your-username',
  
  // Data
  weeks,
  topics
};

/**
 * Tracker Configuration
 */
const TRACKER_CONFIG = {
  // Email settings
  email: {
    // You'll set these in .env file
    from: process.env.FROM_EMAIL,
    to: process.env.TO_EMAIL,
    
    // Email schedule (using cron syntax)
    schedules: {
      dailyCheck: '0 2 * * *',        // 2 AM daily routine
      reminderCheck: '0 18 * * *',    // 6 PM daily
      weeklyReview: '0 9 * * 0'       // 9 AM Sundays
    }
  },
  
  // Progress tracking
  goals: {
    dailyMinimum: 1,      // At least 1 problem per day
    weeklyTarget: 3,      // Target 3 problems per week
    streakGoal: 7         // Aim for 7-day streaks
  },
  
  // API settings
  api: {
    baseUrl: process.env.LEETCODE_API_URL || (() => {
      throw new Error('LEETCODE_API_URL environment variable must be set');
    })(),
    timeout: 10000
  }
};

/**
 * Helper functions for study plan
 */
class StudyPlanHelper {
  
  /**
   * Get current week number based on start date
   */
  static getCurrentWeek() {
    const startDate = new Date(STUDY_PLAN.startDate);
    const today = new Date();
    const diffTime = today.getTime() - startDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.ceil(diffDays / 7);
  }
  
  /**
   * Get problems for a specific week
   */
  static getWeekProblems(weekNumber) {
    return STUDY_PLAN.weeks[weekNumber]?.problems || [];
  }
  
  /**
   * Get current week's problems
   */
  static getCurrentWeekProblems() {
    const currentWeek = this.getCurrentWeek();
    return this.getWeekProblems(currentWeek);
  }
  
  /**
   * Get all problem slugs for easy lookup
   */
  static getAllProblemSlugs() {
    return STUDY_PLAN.topics.flatMap(t=>t.problems.map(p=>p.slug));
  }
  
  /**
   * Check if a problem is in the current study plan
   */
  static isProblemInPlan(problemSlug) {
    return this.getAllProblemSlugs().includes(problemSlug);
  }
  
  /**
   * Get problem details by slug
   */
  static getProblemBySlug(slug) {
    for (const week of Object.values(STUDY_PLAN.weeks)) {
      const problem = week.problems.find(p => p.slug === slug);
      if (problem) return problem;
    }
    return null;
  }
  
  /**
   * Get ordered list of problems as [ { slug, topicIndex, idxWithin } ]
   */
  static getOrderedProblemList(){
    const list=[];
    STUDY_PLAN.topics.forEach((topic,tIdx)=>{
      topic.problems.forEach((p,idx)=>{
        list.push({ ...p, topicIndex:tIdx, problemIndex:idx });
      });
    });
    return list;
  }
  
  /**
   * Given a slug, return the next slug in order (wrap at end)
   */
  static getNextSlug(currentSlug){
    const ordered=this.getOrderedProblemList();
    if(ordered.length===0) return null;
    const idx = ordered.findIndex(it=>it.slug===currentSlug);
    const nextIdx = idx===-1?0:( (idx+1)%ordered.length);
    return ordered[nextIdx];
  }
  
  static getTopicBySlug(slug){
    for(const topic of STUDY_PLAN.topics){
      if(topic.problems.some(p=>p.slug===slug)) return topic.name;
    }
    return 'Unknown';
  }
}

module.exports = {
  STUDY_PLAN,
  TRACKER_CONFIG,
  StudyPlanHelper
}; 