/**
 * Reliability Service
 * 
 * Industry-standard retry and circuit breaker patterns for distributed systems.
 * Implements best practices from AWS SDK, Google Cloud, Netflix Hystrix.
 * 
 * Features:
 * - Exponential backoff with jitter
 * - Circuit breaker pattern
 * - Cold start detection and handling
 * - Adaptive timeouts
 * - Centralized retry logic
 * - Comprehensive error handling
 */

const axios = require('axios');

/**
 * Retry strategies for different scenarios
 */
const RETRY_STRATEGIES = {
  // Normal operation - fast retries for temporary glitches
  normal: {
    maxAttempts: 3,
    baseDelay: 1000,      // 1s
    maxDelay: 10000,      // 10s
    timeoutMultiplier: 1.0,
    backoffMultiplier: 2.0,
    jitterEnabled: true
  },
  
  // Cold start - patient retries for service wake-up
  coldStart: {
    maxAttempts: 8,
    baseDelay: 15000,     // 15s
    maxDelay: 60000,      // 60s
    timeoutMultiplier: 1.5,
    backoffMultiplier: 1.3,
    jitterEnabled: true,
    totalTimeLimit: 600000 // 10 minutes max
  },
  
  // Aggressive - for critical operations
  aggressive: {
    maxAttempts: 12,
    baseDelay: 30000,     // 30s  
    maxDelay: 120000,     // 2 minutes
    timeoutMultiplier: 1.5,
    backoffMultiplier: 1.5,
    jitterEnabled: true,
    totalTimeLimit: 720000 // 12 minutes max
  },
  
  // Fast - for health checks and non-critical ops
  fast: {
    maxAttempts: 2,
    baseDelay: 500,       // 0.5s
    maxDelay: 2000,       // 2s
    timeoutMultiplier: 1.0,
    backoffMultiplier: 2.0,
    jitterEnabled: false
  }
};

/**
 * Circuit breaker states
 */
const CIRCUIT_STATES = {
  CLOSED: 'closed',       // Normal operation
  OPEN: 'open',           // Failing, reject requests
  HALF_OPEN: 'half-open'  // Testing if service recovered
};

class ReliabilityService {
  constructor(options = {}) {
    // Circuit breaker configuration
    this.circuitBreaker = {
      state: CIRCUIT_STATES.CLOSED,
      failureCount: 0,
      successCount: 0,
      lastFailureTime: null,
      failureThreshold: options.failureThreshold || 5,
      recoveryTimeout: options.recoveryTimeout || 600000, // 10 minutes
      halfOpenSuccessThreshold: options.halfOpenSuccessThreshold || 2
    };
    
    // Metrics for monitoring
    this.metrics = {
      totalAttempts: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      coldStartsDetected: 0,
      circuitBreakerTrips: 0
    };
    
    console.log('🛡️ ReliabilityService initialized with enterprise-grade patterns');
  }

  /**
   * Main retry wrapper - the core decorator function
   * Used by all API operations for consistent reliability
   */
  async withRetry(operation, options = {}) {
    const strategy = RETRY_STRATEGIES[options.strategy || 'normal'];
    const operationName = options.name || 'API Operation';
    const startTime = Date.now();
    
    console.log(`🔄 Starting reliable operation: ${operationName}`);
    console.log(`📊 Strategy: ${options.strategy || 'normal'} (${strategy.maxAttempts} attempts max)`);
    
    // Check circuit breaker
    if (this.isCircuitOpen()) {
      const error = new Error(`Circuit breaker is OPEN for ${operationName}`);
      error.circuitBreaker = true;
      throw error;
    }
    
    let lastError = null;
    let attempt = 0;
    
    while (attempt < strategy.maxAttempts) {
      attempt++;
      this.metrics.totalAttempts++;
      
      // Check total time limit
      if (strategy.totalTimeLimit && (Date.now() - startTime) > strategy.totalTimeLimit) {
        console.log(`⏰ Total time limit exceeded for ${operationName}`);
        break;
      }
      
      try {
        const timeout = this.calculateTimeout(strategy, attempt);
        console.log(`\n🔄 ${operationName} - Attempt ${attempt}/${strategy.maxAttempts}`);
        console.log(`⏳ Timeout: ${timeout/1000}s`);
        
        // Execute the operation with timeout
        const result = await this.executeWithTimeout(operation, timeout);
        
        // Success!
        console.log(`✅ ${operationName} succeeded on attempt ${attempt}`);
        this.onSuccess();
        this.metrics.totalSuccesses++;
        
        return result;
        
      } catch (error) {
        lastError = error;
        console.log(`⚠️ ${operationName} attempt ${attempt} failed: ${error.message}`);
        
        // Detect cold start scenarios
        if (this.isColdStartError(error)) {
          console.log(`🌅 Cold start detected for ${operationName}`);
          this.metrics.coldStartsDetected++;
        }
        
        // Don't retry on certain error types
        if (this.isNonRetryableError(error)) {
          console.log(`🚫 Non-retryable error, stopping attempts`);
          break;
        }
        
        // If this is the last attempt, break
        if (attempt >= strategy.maxAttempts) {
          break;
        }
        
        // Calculate wait time and wait
        const waitTime = this.calculateWaitTime(strategy, attempt);
        console.log(`⏳ Waiting ${waitTime/1000}s before retry...`);
        await this.sleep(waitTime);
      }
    }
    
    // All attempts failed
    console.log(`❌ ${operationName} failed after ${attempt} attempts`);
    this.onFailure(lastError);
    this.metrics.totalFailures++;
    
    throw lastError || new Error(`${operationName} failed after all retry attempts`);
  }

  /**
   * Execute operation with timeout
   */
  async executeWithTimeout(operation, timeout) {
    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeout}ms`));
      }, timeout);
      
      try {
        const result = await operation();
        clearTimeout(timeoutId);
        resolve(result);
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  /**
   * Calculate timeout for current attempt
   */
  calculateTimeout(strategy, attempt) {
    const baseTimeout = 15000; // 15s base timeout
    const multiplier = Math.pow(strategy.timeoutMultiplier, attempt - 1);
    return Math.min(baseTimeout * multiplier, strategy.maxDelay);
  }

  /**
   * Calculate wait time with exponential backoff and jitter
   */
  calculateWaitTime(strategy, attempt) {
    // Exponential backoff
    const exponentialDelay = strategy.baseDelay * Math.pow(strategy.backoffMultiplier, attempt - 1);
    
    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, strategy.maxDelay);
    
    // Add jitter to prevent thundering herd
    if (strategy.jitterEnabled) {
      const jitter = Math.random() * 0.3; // ±30% jitter
      return cappedDelay * (1 + jitter);
    }
    
    return cappedDelay;
  }

  /**
   * Detect cold start errors
   */
  isColdStartError(error) {
    const coldStartIndicators = [
      'ECONNRESET',
      'ECONNREFUSED', 
      'ETIMEDOUT',
      'timeout',
      'Service Unavailable',
      'Bad Gateway',
      '502',
      '503',
      '504'
    ];
    
    const errorMessage = error.message || '';
    const errorCode = error.code || '';
    
    return coldStartIndicators.some(indicator => 
      errorMessage.includes(indicator) || errorCode.includes(indicator)
    );
  }

  /**
   * Check if error should not be retried
   */
  isNonRetryableError(error) {
    const nonRetryableCodes = [400, 401, 403, 404, 409, 422];
    const statusCode = error.response?.status;
    
    return nonRetryableCodes.includes(statusCode);
  }

  /**
   * Circuit breaker: check if circuit is open
   */
  isCircuitOpen() {
    if (this.circuitBreaker.state === CIRCUIT_STATES.CLOSED) {
      return false;
    }
    
    if (this.circuitBreaker.state === CIRCUIT_STATES.OPEN) {
      // Check if recovery timeout has passed
      const timeSinceFailure = Date.now() - this.circuitBreaker.lastFailureTime;
      if (timeSinceFailure >= this.circuitBreaker.recoveryTimeout) {
        console.log('🔌 Circuit breaker transitioning to HALF-OPEN');
        this.circuitBreaker.state = CIRCUIT_STATES.HALF_OPEN;
        this.circuitBreaker.successCount = 0;
        return false;
      }
      return true;
    }
    
    // HALF_OPEN state allows limited requests
    return false;
  }

  /**
   * Circuit breaker: handle successful operation
   */
  onSuccess() {
    if (this.circuitBreaker.state === CIRCUIT_STATES.HALF_OPEN) {
      this.circuitBreaker.successCount++;
      if (this.circuitBreaker.successCount >= this.circuitBreaker.halfOpenSuccessThreshold) {
        console.log('✅ Circuit breaker transitioning to CLOSED');
        this.circuitBreaker.state = CIRCUIT_STATES.CLOSED;
        this.circuitBreaker.failureCount = 0;
      }
    } else if (this.circuitBreaker.state === CIRCUIT_STATES.CLOSED) {
      // Reset failure count on success
      this.circuitBreaker.failureCount = 0;
    }
  }

  /**
   * Circuit breaker: handle failed operation
   */
  onFailure(error) {
    this.circuitBreaker.failureCount++;
    this.circuitBreaker.lastFailureTime = Date.now();
    
    if (this.circuitBreaker.state === CIRCUIT_STATES.HALF_OPEN) {
      console.log('🔌 Circuit breaker transitioning to OPEN (half-open failure)');
      this.circuitBreaker.state = CIRCUIT_STATES.OPEN;
      this.metrics.circuitBreakerTrips++;
    } else if (this.circuitBreaker.failureCount >= this.circuitBreaker.failureThreshold) {
      console.log('🔌 Circuit breaker tripped - transitioning to OPEN');
      this.circuitBreaker.state = CIRCUIT_STATES.OPEN;
      this.metrics.circuitBreakerTrips++;
    }
  }

  /**
   * Utility: sleep for specified milliseconds
   */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get reliability metrics for monitoring
   */
  getMetrics() {
    const successRate = this.metrics.totalAttempts > 0 
      ? (this.metrics.totalSuccesses / this.metrics.totalAttempts * 100).toFixed(2)
      : 0;
      
    return {
      ...this.metrics,
      successRate: `${successRate}%`,
      circuitBreakerState: this.circuitBreaker.state,
      circuitBreakerFailureCount: this.circuitBreaker.failureCount
    };
  }

  /**
   * Reset circuit breaker (for testing/debugging)
   */
  resetCircuitBreaker() {
    this.circuitBreaker.state = CIRCUIT_STATES.CLOSED;
    this.circuitBreaker.failureCount = 0;
    this.circuitBreaker.successCount = 0;
    this.circuitBreaker.lastFailureTime = null;
    console.log('🔌 Circuit breaker manually reset');
  }
}

module.exports = {
  ReliabilityService,
  RETRY_STRATEGIES,
  CIRCUIT_STATES
};