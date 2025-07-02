const fs = require('fs');
const handlebars = require('handlebars');
const nodemailer = require('nodemailer');
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
        pass: process.env.EMAIL_PASSWORD
    }
});

/**
 * Get current week's topic based on start date
 */
function getCurrentTopic() {
    const startDate = new Date(systemDesignPlan.metadata.startDate);
    const today = new Date();
    const diffTime = today.getTime() - startDate.getTime();
    const diffWeeks = Math.floor(diffTime / (1000 * 60 * 60 * 24 * 7));
    
    // Find the topic for current week
    let currentTopic = null;
    for (const tier of Object.keys(systemDesignPlan.topics)) {
        const topics = systemDesignPlan.topics[tier];
        currentTopic = topics.find(t => t.week === diffWeeks + 1);
        if (currentTopic) break;
    }
    
    return currentTopic;
}

/**
 * Send system design email
 */
async function sendSystemDesignEmail() {
    try {
        const topic = getCurrentTopic();
        if (!topic) {
            console.log('No topic found for current week');
            return;
        }

        // Generate email content
        const htmlContent = template({ topic });

        // Send email
        const mailOptions = {
            from: process.env.FROM_EMAIL,
            to: process.env.TO_EMAIL,
            subject: `System Design Study: ${topic.name}`,
            html: htmlContent
        };

        await transporter.sendMail(mailOptions);
        console.log(`System design email sent for topic: ${topic.name}`);
    } catch (error) {
        console.error('Error sending system design email:', error);
    }
}

// If running directly (not imported)
if (require.main === module) {
    sendSystemDesignEmail();
}

module.exports = { sendSystemDesignEmail }; 