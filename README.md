# 🎯 LeetCode Progress Tracker 2.0

> **Multi-Problem Support with Web Interface**

A sophisticated LeetCode progress tracker that delivers **1-10 problems per day** via email, with intelligent carry-over logic and a beautiful web interface for configuration.

## ✨ **New in Version 2.0**

### 🎮 **Multi-Problem Daily Delivery**
- Configure **1-10 problems per day** via web interface
- Smart carry-over: unfinished problems repeat until solved
- Progressive advancement: only move forward when problems are completed

### 💻 **Web Interface**
- Beautiful, modern UI for settings management
- Real-time status monitoring
- Manual test and daily check triggers
- Mobile-responsive design

### 🧠 **Intelligent Problem Logic**
- **All Complete**: Send next batch of new problems
- **Partial Complete**: Send unfinished + fill with new problems
- **None Complete**: Resend all unfinished problems (no progression)

---

## 🚀 **Quick Start**

### 1. **Install Dependencies**
```bash
npm install
```

### 2. **Configure Environment**
```bash
cp env.example .env
# Edit .env with your credentials
```

### 3. **Start Web Interface**
```bash
npm run web
```
📱 Open: http://localhost:3000

### 4. **Or Use CLI Mode**
```bash
# Test tracker
node tracker.js test

# Run daily routine once
node tracker.js check

# Start scheduled monitoring (2 AM daily)
node tracker.js start
```

---

## 🎮 **Web Interface Features**

### **📊 Dashboard**
- Current settings overview
- Study plan progress (X/66 problems)
- Pending problems count
- Recent activity summary

### **⚙️ Settings Management**
- Adjust daily problem count (1-10)
- Real-time validation
- Instant feedback

### **🎯 Manual Controls**
- **Test Tracker**: Verify API connectivity and email
- **Run Daily Check**: Trigger routine manually
- **Refresh Status**: Update dashboard data

---

## 📋 **Behavior Examples**

### **Scenario 1: Perfect Progress**
```
User Setting: 3 problems/day

Day 1: Send [A, B, C]
User solves: [A✅, B✅, C✅]
Day 2: Send [D, E, F] (next 3 problems)
```

### **Scenario 2: Partial Completion**
```
User Setting: 3 problems/day

Day 1: Send [A, B, C]
User solves: [A✅, B❌, C✅]
Day 2: Send [B, D, E] (1 unfinished + 2 new)
```

### **Scenario 3: No Progress**
```
User Setting: 3 problems/day

Day 1: Send [A, B, C]
User solves: [A❌, B❌, C❌]
Day 2: Send [A, B, C] (same problems, no advancement)
```

---

## 🔧 **CLI Commands**

### **Settings Management**
```bash
# View current settings
node tracker.js settings get

# Set daily problems (1-10)
node tracker.js settings set 5

# Show comprehensive status
node tracker.js status
```

### **Operations**
```bash
# Test all components
node tracker.js test

# Run daily routine once
node tracker.js check

# Start scheduled monitoring
node tracker.js start
```

---

## 📊 **Data Structure**

### **Settings (settings.json)**
```json
{
  "num_questions": 3,
  "email_enabled": true,
  "created_at": "2025-06-27T10:00:00Z",
  "updated_at": "2025-06-27T15:30:00Z"
}
```

### **Progress (progress.json)**
```json
{
  "lastSentDate": "2025-06-27",
  "sentProblems": [
    {"slug": "two-sum", "solved": true, "sentDate": "2025-06-27"},
    {"slug": "add-two-numbers", "solved": false, "sentDate": "2025-06-27"}
  ],
  "studyPlanPosition": 15,
  "pendingQueue": ["problem-x", "problem-y"],
  "settingsAtSendTime": {
    "num_questions": 3,
    "timestamp": "2025-06-27T02:00:00Z"
  }
}
```

---

## 🚨 **Edge Cases Handled**

### **Settings Changes Mid-Stream**
- User changes from 3→5 problems with 2 unfinished
- **Solution**: Send 2 unfinished + 3 new = 5 total

### **Settings Decrease Below Unfinished Count**
- User changes from 5→2 problems with 4 unfinished
- **Solution**: Send first 2 unfinished, queue remaining 2

### **API Failures**
- Submission checking fails due to timeout
- **Solution**: Conservative approach (assume unsolved)

### **Study Plan Completion**
- Reached end of 66 problems with more requested
- **Solution**: Wrap around or completion mode

---

## 📧 **Email Templates**

### **Mixed Problems Email**
```
Subject: 📝 Today's LeetCode Mix – 1 reminder + 2 new

⏰ Unfinished from Yesterday (1)
Complete these first to progress:
- Two Sum (Easy) - Arrays & Hashing

🆕 New Problems (2)
- Add Two Numbers (Medium) - Linked Lists
- Longest Substring (Medium) - Sliding Window
```

### **All New Problems Email**
```
Subject: 📝 Today's LeetCode – 3 problems

🎯 Your LeetCode Problems for Today
- Problem A (Easy) - Topic 1
- Problem B (Medium) - Topic 2  
- Problem C (Hard) - Topic 3
```

---

## 🛠 **Development**

### **Start Development Server**
```bash
npm run web:dev
```

### **Project Structure**
```
├── tracker.js          # Core engine with multi-problem logic
├── server.js            # Express.js web server
├── study-plan.js        # Study plan management
├── frontend/
│   ├── index.html       # Web interface
│   └── app.js          # Frontend JavaScript
├── progress.json        # Runtime state
├── settings.json        # User settings
└── study-plan.clean.json # Study plan data
```

### **API Endpoints**
- `GET /api/settings` - Current settings
- `POST /api/settings` - Update settings
- `GET /api/progress` - Current progress
- `GET /api/status` - Comprehensive status
- `POST /api/test` - Run tracker test
- `POST /api/check` - Run daily routine

---

## 🎯 **Migration from v1.0**

Your existing `progress.json` will be **automatically migrated** on first run:

```bash
🔄 Migrating old progress format...
📦 Old format detected: { lastSlug: "two-sum", solved: false }
✅ Migrated to new format: { sentProblems: [...], studyPlanPosition: 1 }
```

**Zero downtime, zero data loss!** 🎉

---

## 🔮 **Roadmap**

- [ ] **Streak Tracking**: Visual streak counters and achievements
- [ ] **Weekly Summaries**: Sunday recap emails
- [ ] **Difficulty Balancing**: Smart distribution of Easy/Medium/Hard
- [ ] **Topic Focus Mode**: Concentrate on specific areas
- [ ] **Progress Analytics**: Charts and insights
- [ ] **Mobile App**: Native iOS/Android app

---

## 🤝 **Contributing**

This is a personal project, but feel free to fork and customize for your needs!

---

## 📝 **License**

MIT License - Use freely for your LeetCode journey! 🚀 