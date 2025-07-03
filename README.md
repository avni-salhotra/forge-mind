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