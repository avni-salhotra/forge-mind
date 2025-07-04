/**
 * Firebase Configuration and Database Service
 * 
 * Handles connection to Firebase Firestore for persistent data storage.
 * Replaces local JSON files (progress.json, settings.json) with cloud database.
 * Enhanced with atomic transactions and data validation.
 */

const admin = require('firebase-admin');

// Function to process private key
const processPrivateKey = (key) => {
  if (!key) return undefined;
  // Remove any extra quotes at the start/end if present
  key = key.trim().replace(/^['"]|['"]$/g, '');
  // Replace literal \n with actual newlines
  return key.replace(/\\n/g, '\n');
};

// Firebase configuration using environment variables
const firebaseConfig = {
  credential: admin.credential.cert({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: processPrivateKey(process.env.FIREBASE_PRIVATE_KEY)
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
  },
  version: 1,
  lastModified: new Date().toISOString()
};

// System Design Collections (separate from LeetCode)
const systemDesignCollection = db.collection('system-design-progress');
const systemDesignEmailsCollection = db.collection('system-design-emails');

/**
 * Data validation utilities
 */
class DataValidator {
  static validateSettings(settings) {
    if (!settings || typeof settings !== 'object') {
      throw new Error('Settings must be an object');
    }

    if (typeof settings.num_questions !== 'number' || 
        settings.num_questions < 1 || 
        settings.num_questions > 10) {
      throw new Error('num_questions must be a number between 1 and 10');
    }

    if (typeof settings.email_enabled !== 'boolean') {
      throw new Error('email_enabled must be a boolean');
    }

    return true;
  }

  static validateProgress(progress) {
    if (!progress || typeof progress !== 'object') {
      throw new Error('Progress must be an object');
    }

    if (progress.studyPlanPosition !== undefined) {
      if (typeof progress.studyPlanPosition !== 'number' || progress.studyPlanPosition < 0) {
        throw new Error('studyPlanPosition must be a non-negative number');
      }
    }

    if (progress.sentProblems && !Array.isArray(progress.sentProblems)) {
      throw new Error('sentProblems must be an array');
    }

    if (progress.pendingQueue && !Array.isArray(progress.pendingQueue)) {
      throw new Error('pendingQueue must be an array');
    }

    // Validate sent problems structure
    if (progress.sentProblems) {
      progress.sentProblems.forEach((problem, index) => {
        if (!problem.slug || typeof problem.slug !== 'string') {
          throw new Error(`sentProblems[${index}] must have a valid slug`);
        }
        if (typeof problem.solved !== 'boolean') {
          throw new Error(`sentProblems[${index}] must have a boolean solved property`);
        }
        if (!problem.sentDate || typeof problem.sentDate !== 'string') {
          throw new Error(`sentProblems[${index}] must have a valid sentDate`);
        }
      });
    }

    return true;
  }
}

/**
 * Database Service Class
 * Provides methods to interact with Firestore for progress and settings
 * Enhanced with atomic transactions and proper error handling
 */
class DatabaseService {
  constructor() {
    this.db = db;
    this.userId = 'default'; // Single user for now, could be expanded later
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 second
  }

  /**
   * Execute operation with retry logic
   * @param {Function} operation - Operation to execute
   * @param {string} operationName - Name for logging
   * @returns {Promise} Operation result
   */
  async withRetry(operation, operationName) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        console.warn(`⚠️ ${operationName} attempt ${attempt} failed:`, error.message);
        
        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * attempt;
          console.log(`⏳ Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    console.error(`❌ ${operationName} failed after ${this.maxRetries} attempts`);
    throw lastError;
  }

  /**
   * Atomic progress update with validation and rollback support
   * @param {string} userId - User identifier
   * @param {Function} updateFunction - Function that takes current progress and returns updated progress
   * @returns {Promise<Object>} Updated progress
   */
  async atomicProgressUpdate(userId, updateFunction) {
    return this.withRetry(async () => {
      const progressRef = this.db.collection('users').doc(userId).collection('data').doc('progress');
      
      return this.db.runTransaction(async (transaction) => {
        console.log('🔄 Starting atomic progress update transaction');
        
        // Read current progress
        const progressDoc = await transaction.get(progressRef);
        const currentProgress = progressDoc.exists ? 
          { ...DEFAULT_PROGRESS, ...progressDoc.data() } : 
          DEFAULT_PROGRESS;

        console.log(`📖 Current progress version: ${currentProgress.version || 1}`);
        
        // Apply update function
        const updatedProgress = await updateFunction(currentProgress);
        
        // Validate updated progress
        DataValidator.validateProgress(updatedProgress);
        
        // Add metadata
        const finalProgress = {
          ...updatedProgress,
          lastModified: new Date().toISOString(),
          version: (currentProgress.version || 1) + 1
        };

        console.log(`💾 Saving progress version: ${finalProgress.version}`);
        
        // Write updated progress
        transaction.set(progressRef, finalProgress);
        
        return finalProgress;
      });
    }, 'atomic progress update');
  }

  /**
   * Atomic settings update with validation
   * @param {string} userId - User identifier
   * @param {Function} updateFunction - Function that takes current settings and returns updated settings
   * @returns {Promise<Object>} Updated settings
   */
  async atomicSettingsUpdate(userId, updateFunction) {
    return this.withRetry(async () => {
      const settingsRef = this.db.collection('users').doc(userId).collection('data').doc('settings');
      
      return this.db.runTransaction(async (transaction) => {
        console.log('🔄 Starting atomic settings update transaction');
        
        // Read current settings
        const settingsDoc = await transaction.get(settingsRef);
        const currentSettings = settingsDoc.exists ? 
          { ...DEFAULT_SETTINGS, ...settingsDoc.data() } : 
          DEFAULT_SETTINGS;
        
        // Apply update function
        const updatedSettings = await updateFunction(currentSettings);
        
        // Validate updated settings
        DataValidator.validateSettings(updatedSettings);
        
        // Add metadata
        const finalSettings = {
          ...updatedSettings,
          updated_at: new Date().toISOString()
        };
        
        // Write updated settings
        transaction.set(settingsRef, finalSettings);
        
        return finalSettings;
      });
    }, 'atomic settings update');
  }

  /**
   * Create a checkpoint for rollback purposes
   * @param {string} userId - User identifier
   * @returns {Promise<Object>} Checkpoint data
   */
  async createCheckpoint(userId = this.userId) {
    console.log('📋 Creating checkpoint for rollback...');
    
    const [settings, progress] = await Promise.all([
      this.loadSettings(userId),
      this.loadProgress(userId)
    ]);

    const checkpoint = {
      timestamp: new Date().toISOString(),
      settings: JSON.parse(JSON.stringify(settings)),
      progress: JSON.parse(JSON.stringify(progress)),
      userId
    };

    // Store checkpoint in Firebase for persistence across restarts
    const checkpointRef = this.db.collection('system').doc('checkpoints').collection('data').doc();
    await checkpointRef.set(checkpoint);

    console.log(`✅ Checkpoint created: ${checkpointRef.id}`);
    return {
      id: checkpointRef.id,
      ...checkpoint
    };
  }

  /**
   * Rollback to a checkpoint
   * @param {Object} checkpoint - Checkpoint data
   * @returns {Promise<void>}
   */
  async rollbackToCheckpoint(checkpoint) {
    console.log(`🔄 Rolling back to checkpoint: ${checkpoint.timestamp}`);
    
    return this.withRetry(async () => {
      return this.db.runTransaction(async (transaction) => {
        const userId = checkpoint.userId || this.userId;
        const settingsRef = this.db.collection('users').doc(userId).collection('data').doc('settings');
        const progressRef = this.db.collection('users').doc(userId).collection('data').doc('progress');

        // Restore settings
        transaction.set(settingsRef, {
          ...checkpoint.settings,
          updated_at: new Date().toISOString(),
          restoredFrom: checkpoint.timestamp
        });

        // Restore progress
        transaction.set(progressRef, {
          ...checkpoint.progress,
          lastModified: new Date().toISOString(),
          restoredFrom: checkpoint.timestamp,
          version: (checkpoint.progress.version || 1) + 1
        });

        console.log('✅ Rollback completed successfully');
      });
    }, 'rollback operation');
  }

  /**
   * Load user settings from Firestore
   */
  async loadSettings(userId = this.userId) {
    try {
      const settingsRef = this.db.collection('users').doc(userId).collection('data').doc('settings');
      const settingsSnap = await settingsRef.get();
      
      if (settingsSnap.exists) {
        const settings = { ...DEFAULT_SETTINGS, ...settingsSnap.data() };
        DataValidator.validateSettings(settings);
        console.log('✅ Settings loaded from Firestore');
        return settings;
      } else {
        console.log('📝 No settings found, creating defaults');
        const defaultSettings = { ...DEFAULT_SETTINGS };
        await this.saveSettings(defaultSettings, userId);
        return defaultSettings;
      }
    } catch (error) {
      console.error('❌ Error loading settings from Firestore:', error.message);
      // Fallback to defaults
      return DEFAULT_SETTINGS;
    }
  }

  /**
   * Save user settings to Firestore
   */
  async saveSettings(settings, userId = this.userId) {
    return this.atomicSettingsUpdate(userId, () => settings);
  }

  /**
   * Load progress data from Firestore
   */
  async loadProgress(userId = this.userId) {
    try {
      const progressRef = this.db.collection('users').doc(userId).collection('data').doc('progress');
      const progressSnap = await progressRef.get();
      
      if (progressSnap.exists) {
        const progress = { ...DEFAULT_PROGRESS, ...progressSnap.data() };
        
        // Check if this is old format and migrate (same logic as before)
        if (progress.lastSlug !== undefined) {
          console.log('🔄 Migrating old progress format...');
          return await this.migrateOldProgressSafely(progress, userId);
        }
        
        DataValidator.validateProgress(progress);
        console.log('✅ Progress loaded from Firestore');
        return progress;
      } else {
        console.log('📝 No progress found, using defaults');
        return DEFAULT_PROGRESS;
      }
    } catch (error) {
      console.error('❌ Error loading progress from Firestore:', error.message);
      // Fallback to defaults
      return DEFAULT_PROGRESS;
    }
  }

  /**
   * Save progress data to Firestore
   */
  async saveProgress(progressData, userId = this.userId) {
    return this.atomicProgressUpdate(userId, () => progressData);
  }

  /**
   * Safe migration function for old progress.json format with backup
   */
  async migrateOldProgressSafely(oldData, userId = this.userId) {
    console.log('🔄 Starting safe migration...');
    
    try {
      // Create backup before migration
      const backupRef = this.db.collection('system').doc('migration-backups').collection('data').doc();
      await backupRef.set({
        originalData: oldData,
        migratedAt: new Date().toISOString(),
        userId
      });
      console.log(`📦 Migration backup created: ${backupRef.id}`);
      
      const { StudyPlanHelper } = require('../study-plan');
      const orderedProblems = StudyPlanHelper.getOrderedProblemList();
      
      let studyPlanPosition = 0;
      
      if (oldData.lastSlug) {
        const currentIndex = orderedProblems.findIndex(p => p.slug === oldData.lastSlug);
        if (currentIndex !== -1) {
          studyPlanPosition = currentIndex + 1; // Next problem after last completed
        } else {
          console.warn(`⚠️ Last slug ${oldData.lastSlug} not found in study plan`);
          // Keep existing position or start from 0
          studyPlanPosition = oldData.studyPlanPosition || 0;
        }
      }
      
      const migratedProgress = {
        lastSentDate: oldData.lastSentDate,
        sentProblems: oldData.lastSlug ? [{
          slug: oldData.lastSlug,
          solved: oldData.solved || false,
          sentDate: oldData.lastSentDate,
          migratedFrom: 'legacy'
        }] : [],
        studyPlanPosition: studyPlanPosition,
        pendingQueue: [],
        settingsAtSendTime: {
          num_questions: 1,
          timestamp: oldData.lastSentDate
        },
        migrationInfo: {
          migratedAt: new Date().toISOString(),
          backupId: backupRef.id,
          version: '2.0'
        },
        version: 1,
        lastModified: new Date().toISOString()
      };
      
      // Validate before saving
      DataValidator.validateProgress(migratedProgress);
      
      console.log('✅ Migration completed safely');
      await this.saveProgress(migratedProgress, userId);
      return migratedProgress;
    } catch (error) {
      console.error('❌ Migration failed:', error.message);
      throw new Error(`Migration failed: ${error.message}`);
    }
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
      console.error('❌ Firebase connection failed:', error.message);
      return false;
    }
  }
}

// Create singleton instance
const databaseService = new DatabaseService();

// Export both the service instance and individual functions
module.exports = {
  // Main service
  databaseService,
  // Individual functions for backward compatibility
  loadSettings: (...args) => databaseService.loadSettings(...args),
  saveSettings: (...args) => databaseService.saveSettings(...args),
  loadProgress: (...args) => databaseService.loadProgress(...args),
  saveProgress: (...args) => databaseService.saveProgress(...args),
  testConnection: (...args) => databaseService.testConnection(...args),
  // New atomic functions
  atomicProgressUpdate: (...args) => databaseService.atomicProgressUpdate(...args),
  atomicSettingsUpdate: (...args) => databaseService.atomicSettingsUpdate(...args),
  createCheckpoint: (...args) => databaseService.createCheckpoint(...args),
  rollbackToCheckpoint: (...args) => databaseService.rollbackToCheckpoint(...args),
  // Constants
  DEFAULT_SETTINGS,
  DEFAULT_PROGRESS,
  systemDesignCollection,
  systemDesignEmailsCollection,
  // Validation
  DataValidator
};