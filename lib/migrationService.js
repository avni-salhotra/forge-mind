/**
 * Migration Service
 * 
 * Provides comprehensive migration system for future schema changes.
 * Built to handle data structure evolution while preserving user progress.
 * 
 * Critical for ADHD user - must never lose progress data during updates.
 */

const { DateUtils } = require('./dateUtils');
const { DataValidator, ValidationError } = require('./dataValidator');

/**
 * Migration error with rollback capability
 */
class MigrationError extends Error {
  constructor(message, fromVersion, toVersion, rollbackData = null) {
    super(`Migration ${fromVersion} → ${toVersion}: ${message}`);
    this.name = 'MigrationError';
    this.fromVersion = fromVersion;
    this.toVersion = toVersion;
    this.rollbackData = rollbackData;
  }
}

/**
 * Individual migration definition
 */
class Migration {
  constructor(version, description, migrateFn, rollbackFn = null) {
    this.version = version;
    this.description = description;
    this.migrateFn = migrateFn;
    this.rollbackFn = rollbackFn;
    this.appliedAt = null;
  }

  async apply(data, context = 'unknown') {
    console.log(`🔄 Applying migration ${this.version}: ${this.description}`);
    
    try {
      const result = await this.migrateFn(data, context);
      this.appliedAt = new Date().toISOString();
      console.log(`✅ Migration ${this.version} completed successfully`);
      return result;
    } catch (error) {
      console.error(`❌ Migration ${this.version} failed: ${error.message}`);
      throw new MigrationError(error.message, 'unknown', this.version);
    }
  }

  async rollback(data, context = 'unknown') {
    if (!this.rollbackFn) {
      throw new MigrationError('No rollback function defined', this.version, 'unknown');
    }

    console.log(`🔄 Rolling back migration ${this.version}: ${this.description}`);
    
    try {
      const result = await this.rollbackFn(data, context);
      console.log(`✅ Rollback ${this.version} completed successfully`);
      return result;
    } catch (error) {
      console.error(`❌ Rollback ${this.version} failed: ${error.message}`);
      throw new MigrationError(`Rollback failed: ${error.message}`, this.version, 'unknown');
    }
  }
}

/**
 * Migration Registry
 * Central repository of all migrations with dependency management
 */
class MigrationRegistry {
  constructor() {
    this.migrations = new Map();
    this.migrationHistory = [];
  }

  /**
   * Register a migration
   * @param {Migration} migration - Migration to register
   */
  register(migration) {
    if (!(migration instanceof Migration)) {
      throw new Error('Must register Migration instance');
    }

    if (this.migrations.has(migration.version)) {
      throw new Error(`Migration ${migration.version} already registered`);
    }

    this.migrations.set(migration.version, migration);
    console.log(`📝 Registered migration ${migration.version}: ${migration.description}`);
  }

  /**
   * Get migration by version
   * @param {string} version - Migration version
   * @returns {Migration} Migration instance
   */
  get(version) {
    const migration = this.migrations.get(version);
    if (!migration) {
      throw new Error(`Migration ${version} not found`);
    }
    return migration;
  }

  /**
   * Get all migrations in order
   * @returns {Array<Migration>} Sorted migrations
   */
  getAll() {
    return Array.from(this.migrations.values()).sort((a, b) => a.version.localeCompare(b.version));
  }

  /**
   * Get migrations needed to go from one version to another
   * @param {string} fromVersion - Starting version
   * @param {string} toVersion - Target version
   * @returns {Array<Migration>} Migrations to apply
   */
  getMigrationsPath(fromVersion, toVersion) {
    const allMigrations = this.getAll();
    
    return allMigrations.filter(migration => {
      return migration.version > fromVersion && migration.version <= toVersion;
    });
  }
}

/**
 * Migration Service
 * Handles the execution of migrations with backup and recovery
 */
class MigrationService {
  constructor(databaseService) {
    this.db = databaseService;
    this.registry = new MigrationRegistry();
    this.setupBuiltInMigrations();
  }

  /**
   * Setup built-in migrations for known schema changes
   */
  setupBuiltInMigrations() {
    // Migration 1.0 → 2.0: Old progress.json format to new sentProblems format
    this.registry.register(new Migration(
      '2.0.0',
      'Convert old progress.json to new sentProblems format',
      this.migrateV1ToV2.bind(this),
      this.rollbackV2ToV1.bind(this)
    ));

    // Migration 2.0 → 2.1: Add version tracking to progress data
    this.registry.register(new Migration(
      '2.1.0',
      'Add version and metadata tracking to progress',
      this.migrateV2ToV21.bind(this),
      this.rollbackV21ToV2.bind(this)
    ));

    // Migration 2.1 → 2.2: Enhanced timestamp validation
    this.registry.register(new Migration(
      '2.2.0',
      'Validate and fix timestamp formats in progress data',
      this.migrateV21ToV22.bind(this),
      this.rollbackV22ToV21.bind(this)
    ));

    // Future migration template
    this.registry.register(new Migration(
      '3.0.0',
      'Future schema changes (placeholder)',
      this.migratePlaceholder.bind(this),
      null // No rollback for placeholder
    ));
  }

  /**
   * Migration V1 → V2: Legacy progress.json to modern format
   */
  async migrateV1ToV2(oldData, context) {
    console.log('🔄 Migrating V1 (legacy) to V2 (sentProblems format)...');
    
    // Validate old format
    if (!oldData || typeof oldData !== 'object') {
      throw new Error('Invalid V1 data format');
    }

    const { StudyPlanHelper } = require('../study-plan');
    const orderedProblems = StudyPlanHelper.getOrderedProblemList();
    
    let studyPlanPosition = 0;
    
    // Find current position in study plan based on lastSlug
    if (oldData.lastSlug) {
      const currentIndex = orderedProblems.findIndex(p => p.slug === oldData.lastSlug);
      if (currentIndex !== -1) {
        studyPlanPosition = currentIndex + 1; // Next problem after last completed
        console.log(`📍 Found last slug "${oldData.lastSlug}" at position ${currentIndex}`);
      } else {
        console.warn(`⚠️ Last slug "${oldData.lastSlug}" not found in current study plan`);
        // Use existing position or start from 0
        studyPlanPosition = oldData.studyPlanPosition || 0;
      }
    }
    
    // Create new format
    const migratedData = {
      lastSentDate: oldData.lastSentDate || null,
      sentProblems: oldData.lastSlug ? [{
        slug: oldData.lastSlug,
        solved: Boolean(oldData.solved),
        sentDate: oldData.lastSentDate || DateUtils.getTodayString(),
        migratedFrom: 'v1.0',
        originalData: {
          solved: oldData.solved,
          lastSentDate: oldData.lastSentDate
        }
      }] : [],
      studyPlanPosition: studyPlanPosition,
      pendingQueue: [],
      settingsAtSendTime: {
        num_questions: 1, // Default for V1
        timestamp: oldData.lastSentDate
      },
      version: '2.0.0',
      migrationHistory: [{
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        migratedAt: new Date().toISOString(),
        originalData: JSON.parse(JSON.stringify(oldData)) // Deep copy
      }],
      lastModified: new Date().toISOString()
    };
    
    // Validate new format
    DataValidator.validate(migratedData, 'progress-data', `${context} migration v1→v2`);
    
    console.log(`✅ V1→V2 migration completed. Position: ${studyPlanPosition}, Problems: ${migratedData.sentProblems.length}`);
    return migratedData;
  }

  /**
   * Rollback V2 → V1: Extract original data from migration history
   */
  async rollbackV2ToV1(v2Data, context) {
    console.log('🔄 Rolling back V2 to V1 format...');
    
    if (!v2Data.migrationHistory || v2Data.migrationHistory.length === 0) {
      throw new Error('No migration history found for rollback');
    }

    const originalMigration = v2Data.migrationHistory.find(m => m.fromVersion === '1.0.0');
    if (!originalMigration) {
      throw new Error('Original V1 data not found in migration history');
    }

    console.log(`✅ V2→V1 rollback completed`);
    return originalMigration.originalData;
  }

  /**
   * Migration V2 → V2.1: Add version tracking
   */
  async migrateV2ToV21(v2Data, context) {
    console.log('🔄 Migrating V2.0 to V2.1 (adding version tracking)...');
    
    const migratedData = {
      ...v2Data,
      version: '2.1.0',
      migrationHistory: [
        ...(v2Data.migrationHistory || []),
        {
          fromVersion: v2Data.version || '2.0.0',
          toVersion: '2.1.0',
          migratedAt: new Date().toISOString(),
          changes: ['Added version field', 'Enhanced migration history']
        }
      ],
      lastModified: new Date().toISOString()
    };

    console.log(`✅ V2.0→V2.1 migration completed`);
    return migratedData;
  }

  /**
   * Rollback V2.1 → V2.0
   */
  async rollbackV21ToV2(v21Data, context) {
    console.log('🔄 Rolling back V2.1 to V2.0...');
    
    const { version, migrationHistory, ...v2Data } = v21Data;
    
    // Remove the last migration from history
    if (migrationHistory && migrationHistory.length > 0) {
      v2Data.migrationHistory = migrationHistory.slice(0, -1);
    }

    console.log(`✅ V2.1→V2.0 rollback completed`);
    return v2Data;
  }

  /**
   * Migration V2.1 → V2.2: Validate and fix timestamps
   */
  async migrateV21ToV22(v21Data, context) {
    console.log('🔄 Migrating V2.1 to V2.2 (timestamp validation)...');
    
    const migratedData = { ...v21Data };
    let fixedTimestamps = 0;

    // Validate and fix sentProblems timestamps
    if (migratedData.sentProblems) {
      migratedData.sentProblems.forEach((problem, index) => {
        if (problem.sentDate) {
          try {
            DateUtils.parseDateString(problem.sentDate, `sentProblems[${index}].sentDate`);
          } catch (error) {
            console.warn(`⚠️ Fixing invalid sentDate for ${problem.slug}: ${problem.sentDate}`);
            problem.sentDate = DateUtils.getTodayString();
            fixedTimestamps++;
          }
        }

        if (problem.solvedTimestamp) {
          try {
            DateUtils.parseDateString(problem.solvedTimestamp, `sentProblems[${index}].solvedTimestamp`);
          } catch (error) {
            console.warn(`⚠️ Removing invalid solvedTimestamp for ${problem.slug}: ${problem.solvedTimestamp}`);
            delete problem.solvedTimestamp;
            fixedTimestamps++;
          }
        }
      });
    }

    migratedData.version = '2.2.0';
    migratedData.migrationHistory = [
      ...(migratedData.migrationHistory || []),
      {
        fromVersion: '2.1.0',
        toVersion: '2.2.0',
        migratedAt: new Date().toISOString(),
        changes: [`Fixed ${fixedTimestamps} invalid timestamps`]
      }
    ];
    migratedData.lastModified = new Date().toISOString();

    console.log(`✅ V2.1→V2.2 migration completed. Fixed ${fixedTimestamps} timestamps`);
    return migratedData;
  }

  /**
   * Rollback V2.2 → V2.1
   */
  async rollbackV22ToV21(v22Data, context) {
    console.log('🔄 Rolling back V2.2 to V2.1...');
    
    const migratedData = { ...v22Data };
    migratedData.version = '2.1.0';
    
    // Remove the last migration from history
    if (migratedData.migrationHistory && migratedData.migrationHistory.length > 0) {
      migratedData.migrationHistory = migratedData.migrationHistory.slice(0, -1);
    }

    console.log(`✅ V2.2→V2.1 rollback completed`);
    return migratedData;
  }

  /**
   * Placeholder migration for future use
   */
  async migratePlaceholder(data, context) {
    console.log('🔄 Placeholder migration - no changes needed');
    return data;
  }

  /**
   * Detect current data version
   * @param {Object} data - Data to analyze
   * @returns {string} Detected version
   */
  detectVersion(data) {
    if (!data || typeof data !== 'object') {
      return '1.0.0'; // Assume legacy if invalid
    }

    // Check for explicit version field
    if (data.version && typeof data.version === 'string') {
      return data.version;
    }

    // Detect based on structure
    if (data.sentProblems && Array.isArray(data.sentProblems)) {
      return '2.0.0'; // Has new format but no version field
    }

    if (data.lastSlug && typeof data.lastSlug === 'string') {
      return '1.0.0'; // Legacy format
    }

    // Default to current version if structure is unclear
    return '2.2.0';
  }

  /**
   * Check if migration is needed
   * @param {Object} data - Current data
   * @param {string} targetVersion - Desired version
   * @returns {boolean} True if migration needed
   */
  needsMigration(data, targetVersion = '2.2.0') {
    const currentVersion = this.detectVersion(data);
    return currentVersion !== targetVersion;
  }

  /**
   * Perform migration with backup and validation
   * @param {Object} data - Data to migrate
   * @param {string} targetVersion - Target version
   * @param {string} context - Context for error reporting
   * @returns {Object} Migrated data
   */
  async migrate(data, targetVersion = '2.2.0', context = 'unknown') {
    const currentVersion = this.detectVersion(data);
    
    if (currentVersion === targetVersion) {
      console.log(`✅ Data already at version ${targetVersion}, no migration needed`);
      return data;
    }

    console.log(`🚀 Starting migration from ${currentVersion} to ${targetVersion}`);

    // Create backup
    const backup = {
      data: JSON.parse(JSON.stringify(data)),
      version: currentVersion,
      timestamp: new Date().toISOString(),
      context
    };

    try {
      // Get migration path
      const migrations = this.registry.getMigrationsPath(currentVersion, targetVersion);
      
      if (migrations.length === 0) {
        throw new MigrationError('No migration path found', currentVersion, targetVersion);
      }

      console.log(`📋 Migration path: ${migrations.map(m => m.version).join(' → ')}`);

      // Apply migrations in sequence
      let currentData = data;
      
      for (const migration of migrations) {
        try {
          currentData = await migration.apply(currentData, context);
          
          // Validate after each migration
          DataValidator.validate(currentData, 'progress-data', `${context} after ${migration.version}`);
          
        } catch (error) {
          console.error(`❌ Migration ${migration.version} failed, attempting rollback...`);
          
          // Try to rollback this specific migration if possible
          if (migration.rollbackFn) {
            try {
              currentData = await migration.rollback(currentData, context);
            } catch (rollbackError) {
              console.error(`💥 Rollback also failed: ${rollbackError.message}`);
            }
          }
          
          // Restore from backup
          console.log(`🔄 Restoring from backup...`);
          throw new MigrationError(error.message, currentVersion, targetVersion, backup);
        }
      }

      console.log(`🎉 Migration completed successfully: ${currentVersion} → ${targetVersion}`);
      return currentData;

    } catch (error) {
      if (error instanceof MigrationError) {
        console.error(`💥 Migration failed: ${error.message}`);
        
        if (error.rollbackData) {
          console.log(`🔄 Backup available for manual recovery`);
          console.log(`🔄 Backup timestamp: ${error.rollbackData.timestamp}`);
        }
        
        throw error;
      } else {
        throw new MigrationError(`Unexpected error: ${error.message}`, currentVersion, targetVersion, backup);
      }
    }
  }

  /**
   * Safe migration that doesn't throw
   * @param {Object} data - Data to migrate
   * @param {string} targetVersion - Target version
   * @param {string} context - Context for error reporting
   * @returns {Object} Result with success flag and data/error
   */
  async migrateSafe(data, targetVersion = '2.2.0', context = 'unknown') {
    try {
      const migratedData = await this.migrate(data, targetVersion, context);
      return {
        success: true,
        data: migratedData,
        version: targetVersion,
        error: null
      };
    } catch (error) {
      console.error(`❌ Safe migration failed: ${error.message}`);
      return {
        success: false,
        data: error.rollbackData ? error.rollbackData.data : data,
        version: this.detectVersion(data),
        error: {
          message: error.message,
          fromVersion: error.fromVersion,
          toVersion: error.toVersion,
          rollbackAvailable: Boolean(error.rollbackData)
        }
      };
    }
  }

  /**
   * Get migration status and recommendations
   * @param {Object} data - Data to analyze
   * @returns {Object} Status report
   */
  getStatus(data) {
    const currentVersion = this.detectVersion(data);
    const latestVersion = '2.2.0';
    const needsMigration = this.needsMigration(data, latestVersion);
    
    let recommendations = [];
    
    if (needsMigration) {
      recommendations.push(`Migrate from ${currentVersion} to ${latestVersion}`);
      
      const migrations = this.registry.getMigrationsPath(currentVersion, latestVersion);
      recommendations.push(`${migrations.length} migration(s) required`);
      
      if (currentVersion === '1.0.0') {
        recommendations.push('⚠️ Legacy format detected - migration recommended');
      }
    } else {
      recommendations.push('✅ Data is up to date');
    }

    return {
      currentVersion,
      latestVersion,
      needsMigration,
      isLegacy: currentVersion === '1.0.0',
      recommendations,
      migrationPath: needsMigration ? this.registry.getMigrationsPath(currentVersion, latestVersion).map(m => m.version) : []
    };
  }
}

module.exports = {
  MigrationService,
  Migration,
  MigrationRegistry,
  MigrationError
};