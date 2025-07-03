const fs = require('fs');
const handlebars = require('handlebars');
const nodemailer = require('nodemailer');
const { execSync } = require('child_process');
const path = require('path');
require('dotenv').config();

// Load system design curriculum
const systemDesignPlan = JSON.parse(fs.readFileSync('./system-design-plan.json', 'utf8'));
const emailTemplate = fs.readFileSync('./system-design-email-template.html', 'utf8');

// Compile template
const template = handlebars.compile(emailTemplate);

// Email configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.FROM_EMAIL,
        pass: process.env.EMAIL_PASS
    }
});

let _testDate = null; // For testing purposes

/**
 * Validate environment variables
 */
function validateEnvironment() {
    const required = [
        'FROM_EMAIL',
        'TO_EMAIL',
        'EMAIL_PASS',
        'SYSTEM_DESIGN_START_DATE'
    ];

    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    // Validate date format
    const startDate = new Date(process.env.SYSTEM_DESIGN_START_DATE);
    if (isNaN(startDate.getTime())) {
        throw new Error('Invalid SYSTEM_DESIGN_START_DATE format');
    }
}

/**
 * Validate topic data
 */
function validateTopic(topic) {
    if (!topic) {
        throw new Error('No topic found for current week');
    }

    const required = ['name', 'description', 'diagram', 'videoResources', 'keyConcepts', 'freeResources', 'realWorldExamples'];
    const missing = required.filter(key => !topic[key]);
    
    if (missing.length > 0) {
        throw new Error(`Topic missing required fields: ${missing.join(', ')}`);
    }
}

/**
 * Get current date (or test date if set)
 */
function getCurrentDate() {
    return _testDate || new Date();
}

/**
 * Get current week's topic based on start date
 */
function getCurrentTopic() {
    const startDate = new Date(process.env.SYSTEM_DESIGN_START_DATE);
    const today = getCurrentDate();
    
    // If we haven't reached the start date yet, return null
    if (today < startDate) {
        return null;
    }
    
    const diffTime = today.getTime() - startDate.getTime();
    // Add a small buffer (12 hours) to avoid edge cases around midnight
    const diffWeeks = Math.floor((diffTime + (12 * 60 * 60 * 1000)) / (1000 * 60 * 60 * 24 * 7));
    
    // Count total topics
    let totalTopics = 0;
    Object.values(systemDesignPlan.topics).forEach(tier => {
        totalTopics += tier.length;
    });
    
    // Get the wrapped week number (1-based)
    const wrappedWeek = ((diffWeeks % totalTopics) + 1);
    
    // Find the topic for current week
    let currentTopic = null;
    for (const tier of Object.keys(systemDesignPlan.topics)) {
        const topics = systemDesignPlan.topics[tier];
        currentTopic = topics.find(t => t.week === wrappedWeek);
        if (currentTopic) break;
    }
    
    return currentTopic;
}

/**
 * Convert Mermaid diagram to image URL using mermaid.ink
 */
function getMermaidImageUrl(mermaidCode) {
    try {
        // Extract topic name from the current context
        const topic = getCurrentTopic();
        if (!topic) return null;
        
        // Convert topic name to filename (same as in render-diagrams.js)
        const fileName = topic.name.toLowerCase().replace(/[\s/]+/g, '-') + '.png';
        
        // Return path to static image
        // In production, this should be a full URL to where the images are hosted
        return `${process.env.BASE_URL}/diagrams/${fileName}`;
    } catch (error) {
        console.error('Error getting diagram image URL:', error);
        return null;
    }
}

/**
 * Send system design email
 */
async function sendSystemDesignEmail() {
    try {
        // Validate environment first
        validateEnvironment();

        // Get and validate topic
        const topic = getCurrentTopic();
        validateTopic(topic);

        // Convert Mermaid diagram to image URL
        const diagramUrl = getMermaidImageUrl(topic.diagram);
        const topicWithImage = {
            ...topic,
            diagram: diagramUrl ? `<img src="${diagramUrl}" alt="System Design Diagram" style="max-width: 100%;">` : topic.diagram
        };

        // Generate email content
        const htmlContent = template({ topic: topicWithImage });

        // Send email
        const mailOptions = {
            from: process.env.FROM_EMAIL,
            to: process.env.TO_EMAIL,
            subject: `System Design Study: ${topic.name}`,
            html: htmlContent
        };

        await transporter.sendMail(mailOptions);
        console.log(`✅ System design email sent for topic: ${topic.name}`);
        
        // Log to Firebase if available
        if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
            const { systemDesignEmailsCollection } = require('./lib/firebase');
            await systemDesignEmailsCollection.add({
                topic: topic.name,
                sentAt: new Date(),
                success: true
            });
        }

    } catch (error) {
        console.error('❌ Error sending system design email:', error);
        
        // Log error to Firebase if available
        if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
            const { systemDesignEmailsCollection } = require('./lib/firebase');
            await systemDesignEmailsCollection.add({
                error: error.message,
                sentAt: new Date(),
                success: false
            });
        }
        
        throw error;
    }
}

/**
 * Test the email sending without actually sending
 */
async function testSystemDesignEmail(options = {}) {
    try {
        // Set test date if provided
        if (options.testDate) {
            _testDate = new Date(options.testDate);
        }

        // Validate environment
        validateEnvironment();

        // Get and validate topic
        const topic = getCurrentTopic();
        validateTopic(topic);

        // Generate email content (but don't include in output)
        template({ topic });

        // Minimal console output
        console.log(`✅ Test passed - Topic: ${topic.name} (Week ${topic.week})`);
        
        return {
            success: true,
            topic: topic.name,
            week: topic.week
        };

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        return {
            success: false,
            error: error.message
        };
    } finally {
        // Reset test date
        _testDate = null;
    }
}

// If running directly (not imported)
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.includes('--test')) {
        // Allow testing with a specific date
        const dateArg = args.find(arg => arg.startsWith('--date='));
        const testDate = dateArg ? dateArg.split('=')[1] : null;
        
        testSystemDesignEmail({ testDate })
            .then(result => console.log('\nTest result:', JSON.stringify(result, null, 2)))
            .catch(console.error);
    } else {
        sendSystemDesignEmail()
            .catch(console.error);
    }
}

module.exports = { sendSystemDesignEmail, testSystemDesignEmail }; 