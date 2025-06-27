# 🚀 Local Development Setup Instructions

## **Goal:** Get the alfa-leetcode-api running locally so we can test without rate limits

---

## Step 1: Install Docker Desktop (MacOS)

### **Download & Install:**
1. Go to: https://www.docker.com/products/docker-desktop/
2. Download "Docker Desktop for Mac" 
3. Install the `.dmg` file
4. **Launch Docker Desktop** - you'll see a whale icon in your menu bar

### **Verify Installation:**
```bash
# After Docker Desktop is running, test these commands:
docker --version
docker run hello-world
```

**Expected output:** Docker version info and a "Hello from Docker!" message

---

## Step 2: Run Local LeetCode API

### **Start the API:**
```bash
# This downloads and runs the alfa-leetcode-api locally
docker run -d -p 3000:3000 --name leetcode-api-local alfaarghya/alfa-leetcode-api:2.0.1

# Check if it's running
docker ps
```

### **Test the API:**
```bash
# Test with curl (should return daily challenge data)
curl http://localhost:3000/daily

# Or open in browser: http://localhost:3000/daily
```

**Expected:** JSON response with today's LeetCode challenge

---

## Step 3: Update Our Test Script

### **Modify test-leetcode-api.js:**
```javascript
// Change this line:
const BASE_URL = 'https://alfa-leetcode-api.onrender.com';

// To this:
const BASE_URL = 'http://localhost:3000';
```

### **Run the comprehensive tests:**
```bash
node test-leetcode-api.js
```

**Expected:** All tests should pass without rate limiting! ✅

---

## Step 4: Quick Validation Test

### **Test with your actual LeetCode username:**

Update the test script temporarily:
```javascript
const TEST_CONFIG = {
  testUsername: 'your_actual_username', // Replace with your LeetCode username
  testProblemSlug: 'two-sum',
  testProblemTitle: 'Two Sum',
  timeout: 10000
};
```

Then run:
```bash
node test-leetcode-api.js
```

This will show us your actual submission history and validate the data quality.

---

## Step 5: Cleanup Commands (for later)

### **Stop the API when done:**
```bash
docker stop leetcode-api-local
docker rm leetcode-api-local
```

### **Restart the API:**
```bash
docker start leetcode-api-local
```

---

## 🎯 **What This Accomplishes**

✅ **Validates API functionality** - All endpoints working  
✅ **No rate limiting** - Unlimited testing during development  
✅ **Real data testing** - See your actual LeetCode submissions  
✅ **Fast iteration** - Local network speeds  
✅ **Respectful** - Doesn't overload the hosted service  

---

## 🐳 **Docker Desktop Installation Notes**

### **System Requirements:**
- macOS 10.15 or newer
- 4GB RAM minimum
- ~3GB disk space for Docker

### **If Installation Issues:**
1. **Restart computer** after installation
2. **Check System Settings** → Privacy & Security → Allow Docker
3. **Alternative:** Use Homebrew: `brew install --cask docker`

### **Docker Desktop Benefits:**
- GUI management
- Easy start/stop
- Resource monitoring
- Perfect for development

---

## 🚀 **Next Steps After Setup**

Once the local API is working:

1. **Validate all endpoints** with comprehensive testing
2. **Test with your actual username** to see real data
3. **Start building the core logic** with confidence
4. **Deploy to Railway.app** when ready for production

**This setup gives us unlimited API access for development while being respectful of the hosted service! 🎯** 