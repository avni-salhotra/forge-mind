/**
 * Configuration Module
 * 
 * Centralizes all environment variable handling and validation.
 * Provides typed configuration values and validation.
 */

const validateConfig = () => {
  const requiredVars = [
    'LEETCODE_API_URL',
    'LEETCODE_USERNAME',
    'FROM_EMAIL',
    'TO_EMAIL',
    'EMAIL_SERVICE',
    'EMAIL_USER',
    'EMAIL_PASS',
    'STUDY_PLAN_START_DATE'
  ];

  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(
      'Missing required environment variables:\n' +
      missingVars.map(varName => `  - ${varName}`).join('\n') +
      '\nPlease check your .env file and environment configuration.'
    );
  }
};

const validateUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

const config = {
  leetcode: {
    get apiUrl() {
      const useLocal = process.env.LEETCODE_API_USE_LOCAL === 'true';
      const configuredUrl = process.env.LEETCODE_API_URL;
      
      if (useLocal) {
        return 'http://localhost:3000';
      }
      
      if (!configuredUrl) {
        throw new Error(
          'LEETCODE_API_URL must be set in production environment.\n' +
          'Please set it to your Render deployment URL.'
        );
      }

      if (!validateUrl(configuredUrl)) {
        throw new Error(
          `Invalid LEETCODE_API_URL: ${configuredUrl}\n` +
          'Please provide a valid URL.'
        );
      }

      return configuredUrl;
    },
    get username() {
      return process.env.LEETCODE_USERNAME;
    }
  },
  email: {
    from: process.env.FROM_EMAIL,
    to: process.env.TO_EMAIL,
    service: process.env.EMAIL_SERVICE,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  },
  studyPlan: {
    startDate: process.env.STUDY_PLAN_START_DATE
  },
  firebase: {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
  }
};

// Validate configuration on module load
validateConfig();

module.exports = config; 