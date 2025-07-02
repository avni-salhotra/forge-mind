/**
 * Firebase Configuration and Database Service
 * 
 * Handles connection to Firebase Firestore for persistent data storage.
 * Replaces local JSON files (progress.json, settings.json) with cloud database.
 */

const admin = require('firebase-admin');

// Firebase configuration using environment variables
const firebaseConfig = {
  credential: admin.credential.cert({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  })
};

// Initialize Firebase
const app = admin.initializeApp(firebaseConfig);
const db = admin.firestore(app);

// Default data structures (same as before)
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

/**
 * Database Service Class
 * Provides methods to interact with Firestore for progress and settings
 */
class DatabaseService {
  constructor() {
    this.db = db;
    this.userId = 'default'; // Single user for now, could be expanded later
  }

  /**
   * Load user settings from Firestore
   */
  async loadSettings() {
    try {
      const settingsRef = this.db.collection('users').doc(this.userId).collection('data').doc('settings');
      const settingsSnap = await settingsRef.get();
      
      if (settingsSnap.exists) {
        const settings = settingsSnap.data();
        console.log('✅ Settings loaded from Firestore');
        return { ...DEFAULT_SETTINGS, ...settings };
      } else {
        console.log('📝 No settings found, creating defaults');
        await this.saveSettings(DEFAULT_SETTINGS);
        return DEFAULT_SETTINGS;
      }
    } catch (error) {
      console.error('❌ Error loading settings from Firestore:', error);
      // Fallback to defaults
      return DEFAULT_SETTINGS;
    }
  }

  /**
   * Save user settings to Firestore
   */
  async saveSettings(settings) {
    try {
      const updatedSettings = {
        ...settings,
        updated_at: new Date().toISOString()
      };
      
      const settingsRef = this.db.collection('users').doc(this.userId).collection('data').doc('settings');
      await settingsRef.set(updatedSettings);
      
      console.log('✅ Settings saved to Firestore');
      return updatedSettings;
    } catch (error) {
      console.error('❌ Error saving settings to Firestore:', error);
      throw error;
    }
  }

  /**
   * Load progress data from Firestore
   */
  async loadProgress() {
    try {
      const progressRef = this.db.collection('users').doc(this.userId).collection('data').doc('progress');
      const progressSnap = await progressRef.get();
      
      if (progressSnap.exists) {
        const progress = progressSnap.data();
        console.log('✅ Progress loaded from Firestore');
        
        // Check if this is old format and migrate (same logic as before)
        if (progress.lastSlug !== undefined) {
          console.log('🔄 Migrating old progress format...');
          return await this.migrateOldProgress(progress);
        }
        
        return { ...DEFAULT_PROGRESS, ...progress };
      } else {
        console.log('📝 No progress found, using defaults');
        return DEFAULT_PROGRESS;
      }
    } catch (error) {
      console.error('❌ Error loading progress from Firestore:', error);
      // Fallback to defaults
      return DEFAULT_PROGRESS;
    }
  }

  /**
   * Save progress data to Firestore
   */
  async saveProgress(progressData) {
    try {
      const progress = { ...DEFAULT_PROGRESS, ...progressData };
      
      const progressRef = this.db.collection('users').doc(this.userId).collection('data').doc('progress');
      await progressRef.set(progress);
      
      console.log('✅ Progress saved to Firestore');
      return progress;
    } catch (error) {
      console.error('❌ Error saving progress to Firestore:', error);
      throw error;
    }
  }

  /**
   * Migration function for old progress.json format
   */
  async migrateOldProgress(oldData) {
    console.log('📦 Old format detected:', oldData);
    
    const { StudyPlanHelper } = require('../study-plan');
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
    await this.saveProgress(migratedProgress);
    return migratedProgress;
  }

  /**
   * Test database connection
   */
  async testConnection() {
    try {
      // Try to read settings to test connection
      await this.loadSettings();
      console.log('🔥 Firebase Firestore connection successful!');
      return true;
    } catch (error) {
      console.error('❌ Firebase connection failed:', error);
      return false;
    }
  }
}

// Create singleton instance
const databaseService = new DatabaseService();

module.exports = {
  databaseService,
  DEFAULT_SETTINGS,
  DEFAULT_PROGRESS
}; 