/**
 * Comprehensive Data Validation Framework
 * 
 * Provides validation for:
 * - API endpoint inputs (user inputs from web interface)
 * - External data (LeetCode API responses) 
 * - Internal data (study plan structure, progress data)
 * 
 * Critical for ADHD user - must ensure progress tracking accuracy
 */

const { DateUtils } = require('./dateUtils');

/**
 * Validation error with context
 */
class ValidationError extends Error {
  constructor(message, field, value, context = 'unknown') {
    super(`${context}: ${field} - ${message}`);
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
    this.context = context;
  }
}

/**
 * API Endpoint Validation
 * Validates user inputs from web interface and external API calls
 */
class ApiValidator {
  
  /**
   * Validate settings update request
   * @param {Object} body - Request body from POST /api/settings
   * @throws {ValidationError} If validation fails
   */
  static validateSettingsUpdate(body) {
    const context = 'settings update';
    
    if (!body || typeof body !== 'object') {
      throw new ValidationError('Request body must be an object', 'body', body, context);
    }

    // Validate num_questions
    if ('num_questions' in body) {
      const numQuestions = body.num_questions;
      
      if (typeof numQuestions !== 'number') {
        throw new ValidationError('Must be a number', 'num_questions', numQuestions, context);
      }
      
      if (!Number.isInteger(numQuestions)) {
        throw new ValidationError('Must be an integer', 'num_questions', numQuestions, context);
      }
      
      if (numQuestions < 1 || numQuestions > 10) {
        throw new ValidationError('Must be between 1 and 10', 'num_questions', numQuestions, context);
      }
    }

    // Validate email_enabled if present
    if ('email_enabled' in body) {
      const emailEnabled = body.email_enabled;
      
      if (typeof emailEnabled !== 'boolean') {
        throw new ValidationError('Must be a boolean', 'email_enabled', emailEnabled, context);
      }
    }

    // Check for unexpected fields
    const allowedFields = ['num_questions', 'email_enabled'];
    const unexpectedFields = Object.keys(body).filter(key => !allowedFields.includes(key));
    
    if (unexpectedFields.length > 0) {
      console.warn(`⚠️ ${context}: Unexpected fields ignored: ${unexpectedFields.join(', ')}`);
    }
  }

  /**
   * Validate cron authentication header
   * @param {string} authHeader - Authorization header value
   * @param {string} expectedSecret - Expected secret from environment
   * @throws {ValidationError} If validation fails
   */
  static validateCronAuth(authHeader, expectedSecret) {
    const context = 'cron authentication';
    
    if (!authHeader || typeof authHeader !== 'string') {
      throw new ValidationError('Authorization header is missing or invalid', 'authorization', authHeader, context);
    }
    
    if (!authHeader.startsWith('Bearer ')) {
      throw new ValidationError('Must use Bearer token format', 'authorization', authHeader, context);
    }
    
    if (!expectedSecret || typeof expectedSecret !== 'string') {
      throw new ValidationError('Server configuration error - CRON_SECRET not set', 'server_config', null, context);
    }
    
    const providedSecret = authHeader.substring(7); // Remove 'Bearer '
    
    if (providedSecret.length < 16) {
      throw new ValidationError('Token too short for security', 'authorization', '***', context);
    }
  }

  /**
   * Validate client IP address format
   * @param {string} ip - Client IP address
   * @throws {ValidationError} If validation fails
   */
  static validateClientIP(ip) {
    const context = 'client IP validation';
    
    if (!ip || typeof ip !== 'string') {
      throw new ValidationError('IP address is missing or invalid type', 'ip', ip, context);
    }
    
    // Basic IPv4 pattern
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    // Basic IPv6 pattern (simplified)
    const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
    
    if (!ipv4Pattern.test(ip) && !ipv6Pattern.test(ip) && ip !== 'unknown') {
      console.warn(`⚠️ ${context}: Unusual IP format "${ip}" - may be from proxy`);
    }
  }
}

/**
 * External Data Validation
 * Validates data received from LeetCode API and other external sources
 */
class ExternalDataValidator {
  
  /**
   * Validate LeetCode API submission response
   * @param {Object} response - Response from LeetCode API
   * @param {string} endpoint - API endpoint for context
   * @throws {ValidationError} If validation fails
   */
  static validateSubmissionResponse(response, endpoint = 'unknown') {
    const context = `LeetCode API ${endpoint}`;
    
    if (!response || typeof response !== 'object') {
      throw new ValidationError('Response is not an object', 'response', response, context);
    }
    
    // Check for submission array
    if (!Array.isArray(response.submission)) {
      throw new ValidationError('Submission field must be an array', 'submission', response.submission, context);
    }
    
    // Validate count field if present
    if ('count' in response && typeof response.count !== 'number') {
      console.warn(`⚠️ ${context}: Count field is not a number: ${response.count}`);
    }
    
    // Validate individual submissions
    response.submission.forEach((submission, index) => {
      this.validateSingleSubmission(submission, `${context}[${index}]`);
    });
  }

  /**
   * Validate individual submission object
   * @param {Object} submission - Single submission from API
   * @param {string} context - Context for error reporting
   * @throws {ValidationError} If validation fails
   */
  static validateSingleSubmission(submission, context) {
    if (!submission || typeof submission !== 'object') {
      throw new ValidationError('Submission must be an object', 'submission', submission, context);
    }
    
    // Critical fields for progress tracking
    const requiredFields = ['titleSlug', 'timestamp', 'statusDisplay'];
    
    for (const field of requiredFields) {
      if (!(field in submission)) {
        throw new ValidationError(`Missing required field`, field, undefined, context);
      }
    }
    
    // Validate titleSlug
    if (!submission.titleSlug || typeof submission.titleSlug !== 'string') {
      throw new ValidationError('Must be a non-empty string', 'titleSlug', submission.titleSlug, context);
    }
    
    // Validate timestamp using our DateUtils
    try {
      DateUtils.parseApiTimestamp(submission.timestamp, context);
    } catch (error) {
      throw new ValidationError(`Invalid timestamp: ${error.message}`, 'timestamp', submission.timestamp, context);
    }
    
    // Validate status
    if (!submission.statusDisplay || typeof submission.statusDisplay !== 'string') {
      throw new ValidationError('Must be a non-empty string', 'statusDisplay', submission.statusDisplay, context);
    }
    
    // Warn about unexpected status values
    const knownStatuses = ['Accepted', 'Wrong Answer', 'Time Limit Exceeded', 'Memory Limit Exceeded', 'Runtime Error', 'Compile Error'];
    if (!knownStatuses.includes(submission.statusDisplay)) {
      console.warn(`⚠️ ${context}: Unknown status "${submission.statusDisplay}"`);
    }
  }

  /**
   * Validate LeetCode API user profile response
   * @param {Object} response - User profile response from API
   * @throws {ValidationError} If validation fails
   */
  static validateUserProfile(response) {
    const context = 'LeetCode user profile';
    
    if (!response || typeof response !== 'object') {
      throw new ValidationError('Response is not an object', 'response', response, context);
    }
    
    // Check for username
    if (!response.username || typeof response.username !== 'string') {
      throw new ValidationError('Must have valid username', 'username', response.username, context);
    }
    
    // Validate ranking if present
    if ('ranking' in response && (typeof response.ranking !== 'number' || response.ranking < 0)) {
      console.warn(`⚠️ ${context}: Invalid ranking ${response.ranking}`);
    }
  }
}

/**
 * Internal Data Validation  
 * Validates internal data structures for consistency and correctness
 */
class InternalDataValidator {
  
  /**
   * Validate progress data structure
   * @param {Object} progress - Progress data object
   * @throws {ValidationError} If validation fails
   */
  static validateProgressData(progress) {
    const context = 'progress data';
    
    if (!progress || typeof progress !== 'object') {
      throw new ValidationError('Progress must be an object', 'progress', progress, context);
    }

    // Validate lastSentDate (can be null or valid date string)
    if (progress.lastSentDate !== null) {
      if (typeof progress.lastSentDate !== 'string') {
        throw new ValidationError('Must be string or null', 'lastSentDate', progress.lastSentDate, context);
      }
      
      // Only validate format if it's not null
      if (!DateUtils.isValidAssignmentDate(progress.lastSentDate, 'lastSentDate')) {
        console.warn(`⚠️ ${context}: lastSentDate "${progress.lastSentDate}" seems unusual`);
      }
    }

    // Validate studyPlanPosition
    if (typeof progress.studyPlanPosition !== 'number' || progress.studyPlanPosition < 0) {
      throw new ValidationError('Must be non-negative number', 'studyPlanPosition', progress.studyPlanPosition, context);
    }
    
    if (!Number.isInteger(progress.studyPlanPosition)) {
      throw new ValidationError('Must be an integer', 'studyPlanPosition', progress.studyPlanPosition, context);
    }

    // Validate sentProblems array
    if (!Array.isArray(progress.sentProblems)) {
      throw new ValidationError('Must be an array', 'sentProblems', progress.sentProblems, context);
    }
    
    progress.sentProblems.forEach((problem, index) => {
      this.validateSentProblem(problem, `${context}.sentProblems[${index}]`);
    });

    // Validate pendingQueue
    if (!Array.isArray(progress.pendingQueue)) {
      throw new ValidationError('Must be an array', 'pendingQueue', progress.pendingQueue, context);
    }
    
    progress.pendingQueue.forEach((slug, index) => {
      if (!slug || typeof slug !== 'string') {
        throw new ValidationError('Must be non-empty string', `pendingQueue[${index}]`, slug, context);
      }
    });

    // Validate settingsAtSendTime (optional)
    if (progress.settingsAtSendTime && typeof progress.settingsAtSendTime === 'object') {
      if (typeof progress.settingsAtSendTime.num_questions !== 'number') {
        console.warn(`⚠️ ${context}: settingsAtSendTime.num_questions is not a number`);
      }
    }
  }

  /**
   * Validate individual sent problem object
   * @param {Object} problem - Sent problem object
   * @param {string} context - Context for error reporting
   * @throws {ValidationError} If validation fails
   */
  static validateSentProblem(problem, context) {
    if (!problem || typeof problem !== 'object') {
      throw new ValidationError('Must be an object', 'problem', problem, context);
    }

    // Required fields
    const requiredFields = ['slug', 'solved', 'sentDate'];
    
    for (const field of requiredFields) {
      if (!(field in problem)) {
        throw new ValidationError(`Missing required field`, field, undefined, context);
      }
    }

    // Validate slug
    if (!problem.slug || typeof problem.slug !== 'string') {
      throw new ValidationError('Must be non-empty string', 'slug', problem.slug, context);
    }

    // Validate solved flag
    if (typeof problem.solved !== 'boolean') {
      throw new ValidationError('Must be boolean', 'solved', problem.solved, context);
    }

    // Validate sentDate
    if (!DateUtils.isValidAssignmentDate(problem.sentDate, `${context}.sentDate`)) {
      console.warn(`⚠️ ${context}: sentDate "${problem.sentDate}" seems unusual`);
    }

    // Validate solvedTimestamp if present
    if (problem.solved && problem.solvedTimestamp) {
      try {
        DateUtils.parseDateString(problem.solvedTimestamp, `${context}.solvedTimestamp`);
      } catch (error) {
        console.warn(`⚠️ ${context}: Invalid solvedTimestamp "${problem.solvedTimestamp}"`);
      }
    }
  }

  /**
   * Validate study plan structure
   * @param {Object} studyPlan - Study plan object
   * @throws {ValidationError} If validation fails
   */
  static validateStudyPlan(studyPlan) {
    const context = 'study plan';
    
    if (!studyPlan || typeof studyPlan !== 'object') {
      throw new ValidationError('Study plan must be an object', 'studyPlan', studyPlan, context);
    }

    // Validate username
    if (!studyPlan.username || typeof studyPlan.username !== 'string') {
      throw new ValidationError('Must have valid username', 'username', studyPlan.username, context);
    }

    // Validate topics array
    if (!Array.isArray(studyPlan.topics)) {
      throw new ValidationError('Topics must be an array', 'topics', studyPlan.topics, context);
    }

    studyPlan.topics.forEach((topic, index) => {
      this.validateTopic(topic, `${context}.topics[${index}]`);
    });
  }

  /**
   * Validate individual topic structure
   * @param {Object} topic - Topic object
   * @param {string} context - Context for error reporting
   * @throws {ValidationError} If validation fails
   */
  static validateTopic(topic, context) {
    if (!topic || typeof topic !== 'object') {
      throw new ValidationError('Topic must be an object', 'topic', topic, context);
    }

    // Required fields
    if (!topic.name || typeof topic.name !== 'string') {
      throw new ValidationError('Must have valid name', 'name', topic.name, context);
    }

    if (!Array.isArray(topic.problems)) {
      throw new ValidationError('Problems must be an array', 'problems', topic.problems, context);
    }

    // Validate problems
    topic.problems.forEach((problem, index) => {
      this.validateProblem(problem, `${context}.problems[${index}]`);
    });
  }

  /**
   * Validate individual problem structure
   * @param {Object} problem - Problem object
   * @param {string} context - Context for error reporting  
   * @throws {ValidationError} If validation fails
   */
  static validateProblem(problem, context) {
    if (!problem || typeof problem !== 'object') {
      throw new ValidationError('Problem must be an object', 'problem', problem, context);
    }

    // Required fields
    const requiredFields = ['name', 'slug', 'difficulty'];
    
    for (const field of requiredFields) {
      if (!problem[field] || typeof problem[field] !== 'string') {
        throw new ValidationError(`Must be non-empty string`, field, problem[field], context);
      }
    }

    // Validate difficulty
    const validDifficulties = ['Easy', 'Medium', 'Hard'];
    if (!validDifficulties.includes(problem.difficulty)) {
      console.warn(`⚠️ ${context}: Unknown difficulty "${problem.difficulty}"`);
    }

    // Validate slug format (basic check)
    if (!/^[a-z0-9-]+$/.test(problem.slug)) {
      console.warn(`⚠️ ${context}: Unusual slug format "${problem.slug}"`);
    }
  }
}

/**
 * Unified Validator
 * Provides a single interface for all validation needs
 */
class DataValidator {
  
  /**
   * Validate based on data type and context
   * @param {any} data - Data to validate
   * @param {string} type - Type of validation to perform
   * @param {string} context - Context for error reporting
   * @throws {ValidationError} If validation fails
   */
  static validate(data, type, context = 'unknown') {
    try {
      switch (type) {
        case 'settings-update':
          ApiValidator.validateSettingsUpdate(data);
          break;
        case 'cron-auth':
          ApiValidator.validateCronAuth(data.authHeader, data.expectedSecret);
          break;
        case 'client-ip':
          ApiValidator.validateClientIP(data);
          break;
        case 'submission-response':
          ExternalDataValidator.validateSubmissionResponse(data.response, data.endpoint);
          break;
        case 'user-profile':
          ExternalDataValidator.validateUserProfile(data);
          break;
        case 'progress-data':
          InternalDataValidator.validateProgressData(data);
          break;
        case 'study-plan':
          InternalDataValidator.validateStudyPlan(data);
          break;
        default:
          console.warn(`⚠️ Unknown validation type: ${type}`);
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        // Re-throw validation errors
        throw error;
      } else {
        // Wrap unexpected errors
        throw new ValidationError(`Validation failed: ${error.message}`, 'unknown', data, context);
      }
    }
  }

  /**
   * Safe validation that doesn't throw
   * @param {any} data - Data to validate
   * @param {string} type - Type of validation to perform
   * @param {string} context - Context for error reporting
   * @returns {Object} Result with success flag and error details
   */
  static validateSafe(data, type, context = 'unknown') {
    try {
      this.validate(data, type, context);
      return { success: true, error: null };
    } catch (error) {
      console.error(`❌ Validation failed: ${error.message}`);
      return { 
        success: false, 
        error: {
          message: error.message,
          field: error.field || 'unknown',
          context: error.context || context
        }
      };
    }
  }
}

module.exports = {
  DataValidator,
  ApiValidator,
  ExternalDataValidator,
  InternalDataValidator,
  ValidationError
};