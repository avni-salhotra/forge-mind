# 🎯 ForgeMind: LeetCode + System Design Learning Platform

A comprehensive learning platform that helps you master both LeetCode problems and system design concepts through structured daily practice.

## 🌟 Features

### 1️⃣ LeetCode Progress Tracker
- **Structured Learning Path**: 17 core topics, 66 essential problems
- **Smart Daily Delivery**: 1-10 problems per day (configurable)
- **Progress Management**: Web interface + Firebase persistence
- **Intelligent Problem Selection**: Repeats unsolved problems, ensures mastery

### 2️⃣ System Design Study Guide
- **Weekly Topics**: Systematic coverage of system design concepts
- **Rich Content**: Diagrams, video resources, and real-world examples
- **Comprehensive Format**: Key concepts, implementations, and best practices
- **Visual Learning**: Auto-generated system architecture diagrams

## 🔄 How It Works

### LeetCode Track
1. Daily at 2:00 AM PST:
   - Checks yesterday's solved problems
   - Sends new problems or repeats unsolved ones
   - Updates progress in Firebase

### System Design Track
1. Weekly Topics:
   - Rate limiters, distributed queues, real-time chat, etc.
   - Generated diagrams using Mermaid
   - Curated video content from NeetCode and DesignGurus
   - Real-world implementation examples

## 🛠️ Technical Architecture

### Core Components
- **Backend**: Node.js + Express
- **Database**: Firebase Firestore
- **Email**: Nodemailer with Gmail
- **Hosting**: Render.com
- **Scheduling**: GitHub Actions + Cron

### Project Structure
```
├── Backend Core
│   ├── tracker.js           # LeetCode tracking engine
│   ├── send-system-design.js # System design emailer
│   └── server.js           # Express server
├── Frontend
│   ├── index.html          # Settings dashboard
│   └── diagrams/          # Generated system diagrams
└── Data
    ├── study-plan.json    # LeetCode curriculum
    └── system-design-plan.json # System design topics
```

## 🏗️ Design Pattern Choices

This codebase implements **enterprise-grade reliability patterns** used by companies like Netflix, AWS, and Google. Here's how they work and why they matter:

### 1️⃣ Rate Limiting (Sliding Window)
**Implementation**: `lib/security.js` - `SecurityService`

```js
// Tracks attempts per IP with intelligent windowing
this.maxAttempts = 5;           // 5 failed attempts
this.windowMs = 900000;         // 15-minute window  
this.blockDurationMs = 3600000; // 1-hour block
```

**How it works**:
- Tracks each IP address separately in memory
- Allows 5 attempts per 15-minute sliding window
- Blocks abusive IPs for 1 hour after threshold exceeded
- Automatically resets counters after successful authentication

**Industry usage**:
- **Twitter**: Prevents spam bots during viral events
- **GitHub**: Protects API from repository mining abuse  
- **AWS**: Enables pay-per-use pricing models
- **Stripe**: Prevents payment fraud attempts

### 2️⃣ Circuit Breaker (Netflix Hystrix Pattern)
**Implementation**: `lib/reliabilityService.js` - `ReliabilityService`

```js
// Three-state system: CLOSED → OPEN → HALF_OPEN → CLOSED
const CIRCUIT_STATES = {
  CLOSED: 'closed',       // Normal operation
  OPEN: 'open',           // Failing - reject immediately  
  HALF_OPEN: 'half-open'  // Testing recovery
};
```

**How it works**:
- **CLOSED**: Normal operation, allows all requests
- **OPEN**: After 5 failures, rejects requests instantly (no waiting)
- **HALF_OPEN**: After 10 minutes, tests with limited requests
- **Recovery**: 2 successful requests transition back to CLOSED

**Industry usage**:
- **Netflix**: Prevents cascading failures across microservices
- **AWS Lambda**: Stops infinite retry loops
- **Kubernetes**: Routes traffic away from failing pods
- **Payment systems**: Prevents total outages when fraud detection fails

### 3️⃣ Exponential Backoff with Jitter
**Implementation**: `lib/reliabilityService.js` - `calculateWaitTime()`

```js
// Prevents "thundering herd" synchronized retries
const jitter = Math.random() * 0.3; // ±30% randomization
return cappedDelay * (1 + jitter);
```

**How it works**:
- Base retry: 1s → 2s → 4s → 8s (exponential)
- Jitter adds random 0-30% to spread retry timing
- Prevents 1000+ apps from retrying simultaneously
- Caps maximum delay to prevent infinite waits

**Industry usage**:
- **AWS SDK**: All service calls use exponential backoff
- **Google Cloud**: Prevents API overload during outages
- **Database drivers**: MySQL, PostgreSQL connection retries
- **Message queues**: Kafka, RabbitMQ consumer backoff

### 4️⃣ Cold Start Detection
**Implementation**: `lib/reliabilityService.js` - `isColdStartError()`

```js
// Detects free-tier service wake-up scenarios
const coldStartIndicators = [
  'ECONNRESET', 'ETIMEDOUT', 'Service Unavailable', '502', '503'
];
```

**How it works**:
- Detects when external APIs are "sleeping" (free tier)
- Switches to patient retry strategy (15s → 60s delays)
- Uses longer timeouts and more attempts
- Prevents premature failure during service wake-up

**Industry usage**:
- **AWS Lambda**: Cold start optimization
- **Heroku**: Free dyno wake-up handling
- **Vercel**: Serverless function initialization
- **Docker**: Container startup coordination

### 5️⃣ Adaptive Retry Strategies
**Implementation**: `lib/reliabilityService.js` - `RETRY_STRATEGIES`

```js
// Different strategies for different scenarios
normal: { maxAttempts: 3, baseDelay: 1000 },      // Quick failures
coldStart: { maxAttempts: 8, baseDelay: 15000 },  // Patient waiting  
aggressive: { maxAttempts: 12, baseDelay: 30000 }, // Critical ops
fast: { maxAttempts: 2, baseDelay: 500 }          // Health checks
```

**How it works**:
- **Normal**: Fast retries for temporary glitches
- **Cold Start**: Patient retries for service wake-up
- **Aggressive**: Maximum persistence for critical operations
- **Fast**: Quick failure for non-essential checks

**Industry usage**:
- **Database connections**: Different strategies for reads vs writes
- **Payment processing**: Aggressive retries for transaction completion
- **Monitoring systems**: Fast failure for health checks
- **File uploads**: Patient retries for large transfers

### 6️⃣ Memory-Efficient Design
**Implementation**: `lib/security.js` - Automatic cleanup

```js
// Prevents memory leaks in long-running processes
setInterval(() => this.cleanup(), 300000); // Clean every 5 minutes
```

**How it works**:
- Uses JavaScript `Map` for O(1) IP lookups
- Automatically removes stale entries
- Designed for Render free tier memory constraints
- Scales efficiently with user growth

**Industry usage**:
- **Redis**: TTL-based key expiration
- **CDN caches**: LRU eviction policies
- **Application servers**: Session cleanup
- **Log aggregation**: Rolling window storage

### 🎯 Why These Patterns Matter

**Without these patterns**:
```
😱 One angry user makes 1000 API calls → Server crashes
😱 External API goes down → Your app waits 5 minutes per request
😱 1000 apps retry simultaneously → "Thundering herd" kills API
😱 Memory leaks → App crashes after 24 hours
```

**With these patterns**:
```
✅ Abusive users get blocked automatically
✅ Failed APIs fail fast (instant feedback)
✅ Retry timing is randomized (no coordination issues)
✅ Memory usage stays constant over time
```

**Real-world impact**: These are the **same patterns** that power:
- Netflix's 99.99% uptime during partial outages
- AWS's ability to handle millions of requests/second
- Google's graceful handling of traffic spikes
- Stripe's reliable payment processing during Black Friday

Your LeetCode tracker essentially implements **Netflix-grade reliability** for personal use! 🚀

## 🚀 Getting Started

1. **Installation**
   ```bash
   npm install
   cp env.example .env
   # Configure your .env file
   ```

2. **Environment Variables**
   ```
   # Core Configuration
   EMAIL_USER=your-email@gmail.com
   EMAIL_PASS=your-app-password
   LEETCODE_USERNAME=your-username
   
   # System Design Config
   SYSTEM_DESIGN_START_DATE=2025-01-01
   BASE_URL=https://your-app.render.com
   ```

3. **Local Development**
   ```bash
   npm run dev     # Start development server
   npm run test    # Run test suite
   ```

## 🎮 Usage

### Web Dashboard
- Configure daily problem count (1-10)
- View progress and statistics
- Trigger manual checks

### CLI Commands
```bash
node tracker.js check        # Run daily routine
node tracker.js status      # Show current state
node tracker.js settings    # Manage settings
```

## 📧 Email Templates

### LeetCode Problems
- Daily problem notifications
- Reminder emails for unsolved problems
- Progress celebration emails

### System Design Topics
- Weekly topic introduction
- System architecture diagrams
- Video resources and key concepts
- Real-world implementation examples

## 🔐 Security & Reliability

- **Authentication**: Bearer token for API endpoints
- **Rate Limiting**: Smart retry logic for API calls
- **Error Handling**: Graceful degradation on API failures
- **Monitoring**: Health check endpoints and logging

## 🔄 Edge Cases Handled

- API cold starts and timeouts
- Timezone differences in date calculations
- Service wake-up coordination
- Large response handling

## 🎯 Future Roadmap

- [ ] Mobile app for progress tracking
- [ ] Interactive system design quizzes
- [ ] Community features and discussions
- [ ] Personal notes and bookmarks
- [ ] Advanced analytics dashboard

## 📝 License

MIT License - Feel free to use and modify for your learning journey! 🚀