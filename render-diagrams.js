const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

// Load system design curriculum
const systemDesignPlan = JSON.parse(fs.readFileSync('./system-design-plan.json', 'utf8'));

// Create diagrams directory if it doesn't exist
const diagramsDir = path.join(__dirname, 'diagrams');
if (!fs.existsSync(diagramsDir)) {
    fs.mkdirSync(diagramsDir);
}

// Extract and render all diagrams
let diagramCount = 0;
Object.values(systemDesignPlan.topics).forEach(tier => {
    tier.forEach(topic => {
        const diagramCode = topic.diagram;
        // Convert topic name to safe filename (replace spaces and slashes with hyphens)
        const fileName = `${topic.name.toLowerCase().replace(/[\s\/]+/g, '-')}.png`;
        const filePath = path.join(diagramsDir, fileName);
        
        // Write diagram code to temp file
        const tempFile = path.join(__dirname, 'temp.mmd');
        fs.writeFileSync(tempFile, diagramCode);
        
        try {
            // Render diagram using mermaid-cli
            execSync(`npx mmdc -i ${tempFile} -o ${filePath} -t dark -b white`);
            console.log(`✅ Rendered diagram for ${topic.name}`);
            diagramCount++;
        } catch (error) {
            console.error(`❌ Failed to render diagram for ${topic.name}:`, error.message);
        } finally {
            // Clean up temp file
            fs.unlinkSync(tempFile);
        }
    });
});

console.log(`\n🎨 Rendered ${diagramCount} diagrams in ./diagrams directory`);

// Update the code to use static images
const sendSystemDesignFile = path.join(__dirname, 'send-system-design.js');
let code = fs.readFileSync(sendSystemDesignFile, 'utf8');

// Replace getMermaidImageUrl function with static image version
const newFunction = `function getMermaidImageUrl(mermaidCode) {
    try {
        // Extract topic name from the current context
        const topic = getCurrentTopic();
        if (!topic) return null;
        
        // Convert topic name to filename (same as in render-diagrams.js)
        const fileName = topic.name.toLowerCase().replace(/[\s\/]+/g, '-') + '.png';
        
        // Return path to static image
        // In production, this should be a full URL to where the images are hosted
        return \`\${process.env.BASE_URL}/diagrams/\${fileName}\`;
    } catch (error) {
        console.error('Error getting diagram image URL:', error);
        return null;
    }
}`;

// Replace the old function with the new one
code = code.replace(/function getMermaidImageUrl[\s\S]*?}/, newFunction);

fs.writeFileSync(sendSystemDesignFile, code);
console.log('\n✅ Updated send-system-design.js to use static images'); 