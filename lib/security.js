/**
 * Security Service
 * 
 * Handles rate limiting, IP tracking, and authentication security measures.
 * Designed to work within Render free tier memory constraints.
 */

class SecurityService {
  constructor() {
    this.attemptTracker = new Map(); // IP -> { count, lastAttempt, blockedUntil }
    this.maxAttempts = parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS) || 5;
    this.windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000; // 15 minutes
    this.blockDurationMs = parseInt(process.env.RATE_LIMIT_BLOCK_DURATION_MS) || 3600000; // 1 hour
    
    // Cleanup interval to prevent memory leaks
    this.cleanupInterval = setInterval(() => this.cleanup(), 300000); // 5 minutes
    
    console.log('🛡️ Security service initialized');
    console.log(`   Rate limit: ${this.maxAttempts} attempts per ${this.windowMs/60000} minutes`);
    console.log(`   Block duration: ${this.blockDurationMs/60000} minutes`);
  }

  /**
   * Check if an IP is rate limited
   * @param {string} ip - Client IP address
   * @throws {Error} If rate limit exceeded
   */
  checkRateLimit(ip) {
    if (!ip) {
      throw new Error('IP address required for rate limiting');
    }

    const now = Date.now();
    const attempts = this.attemptTracker.get(ip) || { 
      count: 0, 
      lastAttempt: 0, 
      blockedUntil: null 
    };

    // Check if currently blocked
    if (attempts.blockedUntil && now < attempts.blockedUntil) {
      const remainingMs = attempts.blockedUntil - now;
      throw new Error(`Rate limit exceeded. Try again in ${Math.ceil(remainingMs/60000)} minutes`);
    }

    // Reset window if expired
    if (now - attempts.lastAttempt > this.windowMs) {
      attempts.count = 0;
      attempts.blockedUntil = null;
    }

    // Check if exceeding limit
    if (attempts.count >= this.maxAttempts) {
      attempts.blockedUntil = now + this.blockDurationMs;
      this.attemptTracker.set(ip, attempts);
      
      console.warn(`🚨 IP ${ip} blocked for ${this.blockDurationMs/60000} minutes (${attempts.count} attempts)`);
      throw new Error(`Rate limit exceeded. Blocked for ${this.blockDurationMs/60000} minutes`);
    }

    // Record attempt
    attempts.count++;
    attempts.lastAttempt = now;
    this.attemptTracker.set(ip, attempts);

    console.log(`🔍 Rate limit check: IP ${ip} - ${attempts.count}/${this.maxAttempts} attempts`);
  }

  /**
   * Record successful authentication (reset rate limit for IP)
   * @param {string} ip - Client IP address
   */
  recordSuccess(ip) {
    if (this.attemptTracker.has(ip)) {
      this.attemptTracker.delete(ip);
      console.log(`✅ Rate limit reset for IP ${ip} after successful auth`);
    }
  }

  /**
   * Clean up old entries to prevent memory leaks
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [ip, attempts] of this.attemptTracker.entries()) {
      // Remove entries older than window + block duration
      const maxAge = this.windowMs + this.blockDurationMs;
      if (now - attempts.lastAttempt > maxAge) {
        this.attemptTracker.delete(ip);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 Security cleanup: removed ${cleaned} old rate limit entries`);
    }
  }

  /**
   * Get current rate limit status for an IP
   * @param {string} ip - Client IP address
   * @returns {Object} Status information
   */
  getStatus(ip) {
    const attempts = this.attemptTracker.get(ip);
    if (!attempts) {
      return { attempts: 0, blocked: false, remaining: this.maxAttempts };
    }

    const now = Date.now();
    const blocked = attempts.blockedUntil && now < attempts.blockedUntil;
    const remaining = Math.max(0, this.maxAttempts - attempts.count);

    return {
      attempts: attempts.count,
      blocked,
      remaining,
      blockedUntil: attempts.blockedUntil,
      windowResetAt: attempts.lastAttempt + this.windowMs
    };
  }

  /**
   * Destroy the service and clean up resources
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.attemptTracker.clear();
    console.log('🛡️ Security service destroyed');
  }
}

/**
 * Secure configuration validator
 * Validates environment variables without exposing sensitive values
 */
class ConfigValidator {
  static validateAndSanitize() {
    const required = [
      'FIREBASE_PRIVATE_KEY',
      'EMAIL_PASS',
      'CRON_SECRET',
      'FROM_EMAIL',
      'TO_EMAIL'
    ];

    const optional = [
      'RATE_LIMIT_MAX_ATTEMPTS',
      'RATE_LIMIT_WINDOW_MS', 
      'RATE_LIMIT_BLOCK_DURATION_MS'
    ];

    // Check required variables
    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(process.env.FROM_EMAIL)) {
      throw new Error('Invalid FROM_EMAIL format');
    }
    if (!emailRegex.test(process.env.TO_EMAIL)) {
      throw new Error('Invalid TO_EMAIL format');
    }

    // Validate Firebase private key format
    if (!process.env.FIREBASE_PRIVATE_KEY.includes('BEGIN PRIVATE KEY')) {
      throw new Error('Invalid FIREBASE_PRIVATE_KEY format');
    }

    // Return sanitized config for logging
    const sanitized = { ...process.env };
    const sensitive = ['FIREBASE_PRIVATE_KEY', 'EMAIL_PASS', 'CRON_SECRET'];
    
    sensitive.forEach(key => {
      if (sanitized[key]) {
        sanitized[key] = '[REDACTED]';
      }
    });

    console.log('✅ Configuration validated successfully');
    console.log(`   FROM_EMAIL: ${process.env.FROM_EMAIL}`);
    console.log(`   TO_EMAIL: ${process.env.TO_EMAIL}`);
    console.log(`   Optional config: ${optional.filter(key => process.env[key]).length}/${optional.length} set`);

    return sanitized;
  }

  /**
   * Get client IP from request, handling various proxy scenarios
   * @param {Object} req - Express request object
   * @returns {string} Client IP address
   */
  static getClientIP(req) {
    // Check various headers that might contain the real IP
    const possibleHeaders = [
      'x-forwarded-for',
      'x-real-ip',
      'x-client-ip',
      'cf-connecting-ip', // Cloudflare
      'x-forwarded',
      'forwarded-for',
      'forwarded'
    ];

    for (const header of possibleHeaders) {
      const value = req.headers[header];
      if (value) {
        // x-forwarded-for can contain multiple IPs, take the first one
        const ip = value.split(',')[0].trim();
        if (this.isValidIP(ip)) {
          return ip;
        }
      }
    }

    // Fallback to connection remote address
    return req.connection?.remoteAddress || 
           req.socket?.remoteAddress || 
           req.ip || 
           'unknown';
  }

  /**
   * Basic IP address validation
   * @param {string} ip - IP address to validate
   * @returns {boolean} True if valid IP format
   */
  static isValidIP(ip) {
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    
    return ipv4Regex.test(ip) || ipv6Regex.test(ip);
  }
}

module.exports = {
  SecurityService,
  ConfigValidator
};