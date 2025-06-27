const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

/**
 * Docker Verification and API Setup Script
 * 
 * This script helps verify Docker installation and start the local LeetCode API
 */

async function checkDocker() {
  console.log('🐳 Checking Docker installation...\n');
  
  try {
    const { stdout } = await execAsync('docker --version');
    console.log('✅ Docker is installed!');
    console.log(`📋 Version: ${stdout.trim()}`);
    return true;
  } catch (error) {
    console.log('❌ Docker is not installed or not in PATH');
    console.log('📥 Please install Docker Desktop from: https://www.docker.com/products/docker-desktop/');
    return false;
  }
}

async function checkDockerRunning() {
  console.log('\n🔍 Checking if Docker is running...');
  
  try {
    await execAsync('docker ps');
    console.log('✅ Docker is running!');
    return true;
  } catch (error) {
    console.log('❌ Docker is not running');
    console.log('🚀 Please start Docker Desktop (look for whale icon in menu bar)');
    return false;
  }
}

async function startLeetCodeAPI() {
  console.log('\n🚀 Starting local LeetCode API...');
  
  try {
    // Check if container already exists
    try {
      const { stdout } = await execAsync('docker ps -a --filter name=leetcode-api-local');
      if (stdout.includes('leetcode-api-local')) {
        console.log('📦 Container already exists. Starting it...');
        await execAsync('docker start leetcode-api-local');
        console.log('✅ LeetCode API container started!');
        return true;
      }
    } catch (e) {
      // Container doesn't exist, create it
    }
    
    // Create and start new container
    console.log('📥 Downloading and starting LeetCode API (may take a moment)...');
    await execAsync('docker run -d -p 3000:3000 --name leetcode-api-local alfaarghya/alfa-leetcode-api:2.0.1');
    console.log('✅ LeetCode API is now running on localhost:3000!');
    return true;
    
  } catch (error) {
    console.log('❌ Failed to start LeetCode API');
    console.log('💥 Error:', error.message);
    
    if (error.message.includes('port is already allocated')) {
      console.log('\n💡 Tip: Port 3000 is already in use. Try stopping other services on port 3000');
      console.log('Or check if the API is already running: docker ps');
    }
    
    return false;
  }
}

async function testAPIConnection() {
  console.log('\n🧪 Testing API connection...');
  
  try {
    const axios = require('axios');
    const response = await axios.get('http://localhost:3000/daily', { timeout: 5000 });
    console.log('✅ API is responding!');
    console.log(`📊 Status: ${response.status}`);
    console.log(`📅 Today's challenge: ${response.data.questionTitle || 'N/A'}`);
    return true;
  } catch (error) {
    console.log('❌ API is not responding');
    console.log('💥 Error:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.log('\n💡 Tips:');
      console.log('   - Wait 10-20 seconds for the container to fully start');
      console.log('   - Check if container is running: docker ps');
      console.log('   - Try opening http://localhost:3000/daily in your browser');
    }
    
    return false;
  }
}

async function showNextSteps() {
  console.log('\n' + '='.repeat(60));
  console.log('🎯 READY FOR API TESTING!');
  console.log('='.repeat(60));
  console.log('');
  console.log('✅ Docker is running');
  console.log('✅ LeetCode API is available at localhost:3000');
  console.log('');
  console.log('🚀 Next steps:');
  console.log('   1. Run comprehensive API tests: node test-leetcode-api.js');
  console.log('   2. Open http://localhost:3000/daily in browser to see API');
  console.log('   3. Update test username to yours for real data testing');
  console.log('');
  console.log('🛠️  Useful commands:');
  console.log('   • Stop API: docker stop leetcode-api-local');
  console.log('   • Start API: docker start leetcode-api-local');
  console.log('   • View logs: docker logs leetcode-api-local');
  console.log('   • Remove API: docker rm leetcode-api-local');
  console.log('');
  console.log('🎯 Once testing is complete, we can start building the tracker!');
}

async function main() {
  console.log('🔧 Docker & LeetCode API Setup Verification\n');
  
  // Step 1: Check Docker installation
  const dockerInstalled = await checkDocker();
  if (!dockerInstalled) {
    return;
  }
  
  // Step 2: Check if Docker is running
  const dockerRunning = await checkDockerRunning();
  if (!dockerRunning) {
    return;
  }
  
  // Step 3: Start LeetCode API
  const apiStarted = await startLeetCodeAPI();
  if (!apiStarted) {
    return;
  }
  
  // Wait a moment for API to fully start
  console.log('\n⏳ Waiting for API to fully start...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Step 4: Test API connection
  const apiWorking = await testAPIConnection();
  if (!apiWorking) {
    console.log('\n💡 The API might need more time to start. Try running this again in 10-20 seconds.');
    return;
  }
  
  // Step 5: Show next steps
  await showNextSteps();
}

// Run the verification
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { checkDocker, checkDockerRunning, startLeetCodeAPI, testAPIConnection }; 