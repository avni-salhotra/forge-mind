# 🎯 Simplified LeetCode Tracker - Behavior-Driven System

**Core Concept:** Simple accountability system that checks daily progress and responds appropriately
**Timeline:** 2-3 weeks (much more achievable!)
**Tech Stack:** Node.js, JSON files, Gmail API, alfa-leetcode-api (self-hosted)
**User Goal:** 1 problem per day minimum, with gentle accountability

---

## 🧠 **Core Logic (Simple & Effective)**

```javascript
// Daily check logic at midnight
async function dailyAccountabilityCheck() {
  const today = new Date().toISOString().split('T')[0];
  const userSubmissions = await getLeetCodeSubmissions(today);
  const currentQuestion = await getCurrentQuestion();
  
  if (userSubmissions.length === 0) {
    // No submissions today - send stern reminder
    await sendSternReminder(currentQuestion);
    console.log("📧 Sent reminder: Same question, try again!");
    
  } else if (userSubmissions.length === 1) {
    // Perfect! Exactly 1 question done
    await markQuestionComplete(currentQuestion);
    const nextQuestion = await getNextQuestion();
    await sendNewQuestion(nextQuestion);
    console.log("🎉 Goal met! Sent new question.");
    
  } else {
    // Exceeded goal! Send encouragement
    await markQuestionComplete(currentQuestion);
    const nextQuestion = await getNextQuestion();
    await sendCongratulations(nextQuestion, userSubmissions.length);
    console.log(`🔥 Overachiever! Completed ${userSubmissions.length} problems!`);
  }
}
```

---

## 📊 **Simple Data Structure**

```javascript
// data/current-state.json
{
  "currentQuestion": {
    "titleSlug": "two-sum",
    "title": "Two Sum",
    "difficulty": "Easy",
    "url": "https://leetcode.com/problems/two-sum/",
    "assignedDate": "2025-01-18",
    "attempts": 1,
    "lastReminderSent": "2025-01-19"
  },
  "questionQueue": [
    "two-sum",
    "add-two-numbers", 
    "longest-substring-without-repeating-characters"
    // Can be from Trello or predefined list
  ],
  "stats": {
    "streak": 5,
    "totalCompleted": 23,
    "lastCompletionDate": "2025-01-17"
  }
}

// data/daily-log.json
{
  "2025-01-18": {
    "questionsCompleted": 1,
    "problems": ["two-sum"],
    "emailSent": "new_question",
    "goalMet": true
  },
  "2025-01-17": {
    "questionsCompleted": 0,
    "emailSent": "reminder",
    "goalMet": false
  }
}
```

---

## 📧 **Three Email Types**

### **1. New Question Email (Success)**
```
Subject: 🎯 Your Next LeetCode Challenge

Great job completing "Two Sum" yesterday! 

Here's your next challenge:

🔴 PROBLEM: Add Two Numbers
⚡ Difficulty: Medium
🔗 Link: https://leetcode.com/problems/add-two-numbers/

Target: Complete by tomorrow midnight
Current streak: 6 days 🔥

Good luck!
```

### **2. Stern Reminder Email (Missed Day)**
```
Subject: ⏰ LeetCode Reminder - Same Problem

You haven't completed yesterday's problem yet.

🔴 STILL PENDING: Two Sum
⚡ Difficulty: Easy
🔗 Link: https://leetcode.com/problems/two-sum/

This is day 2 of this problem. Let's get it done today! 
Your streak is waiting: 5 days → could be 6! 🎯

No new problem until this one is complete.
```

### **3. Congratulations Email (Exceeded Goal)**
```
Subject: 🔥 Overachiever Alert! 

Wow! You completed 3 problems yesterday:
✅ Two Sum
✅ Add Two Numbers  
✅ Longest Substring Without Repeating Characters

That's 200% above your daily goal! 🚀

Here's your next challenge:

🔴 PROBLEM: Median of Two Sorted Arrays
⚡ Difficulty: Hard
🔗 Link: https://leetcode.com/problems/median-of-two-sorted-arrays/

Current streak: 7 days 🔥
Keep up the momentum!
```

---

## 🛠️ **Implementation Plan (2-3 Weeks)**

### **Week 1: Core System**
- [ ] Set up self-hosted alfa-leetcode-api locally
- [ ] Build LeetCode submission checker
- [ ] Create simple question queue system
- [ ] Set up Gmail API for email sending
- [ ] Build the three email templates
- [ ] Create midnight cron job

### **Week 2: Polish & Test**
- [ ] Add streak tracking
- [ ] Implement question queue management
- [ ] Test email delivery
- [ ] Handle edge cases (API failures, etc.)
- [ ] Add simple CLI for manual operations

### **Week 3: Deploy & Monitor**
- [ ] Deploy to VPS with self-hosted API
- [ ] Set up monitoring/logging
- [ ] Test in production for a week
- [ ] Fine-tune email timing and content

---

## 🔧 **Key Files Structure**

```
leetcode-accountability/
├── src/
│   ├── api/
│   │   └── leetcode.js          # API wrapper
│   ├── email/
│   │   ├── templates.js         # 3 email types
│   │   └── sender.js            # Gmail integration
│   ├── core/
│   │   ├── checker.js           # Daily accountability logic
│   │   ├── queue.js             # Question queue management
│   │   └── stats.js             # Streak/progress tracking
│   └── utils/
│       └── storage.js           # JSON file operations
├── data/
│   ├── current-state.json       # Current question & stats
│   ├── daily-log.json           # Historical daily records
│   └── question-queue.json      # List of problems to assign
├── scripts/
│   └── midnight-check.js        # Main cron job script
├── docker-compose.yml           # Self-hosted API + app
└── .env                         # Configuration
```

---

## ⚙️ **Environment Variables (Simple)**

```bash
# .env
LEETCODE_USERNAME=your_username

# Gmail
GMAIL_CLIENT_ID=your_gmail_client_id
GMAIL_CLIENT_SECRET=your_gmail_client_secret  
GMAIL_REFRESH_TOKEN=your_refresh_token
EMAIL_TO=your_email@gmail.com

# System
LEETCODE_API_URL=http://localhost:3000
CHECK_TIME=00:00  # Midnight
TIMEZONE=America/Los_Angeles

# Optional: Trello integration for question queue
TRELLO_API_KEY=your_key
TRELLO_BOARD_ID=your_board_id
```

---

## 🐳 **Docker Setup (Self-Hosted API)**

```yaml
# docker-compose.yml
version: '3.8'
services:
  leetcode-api:
    image: alfaarghya/alfa-leetcode-api:2.0.1
    ports:
      - "3000:3000"
    restart: unless-stopped

  accountability-tracker:
    build: .
    depends_on:
      - leetcode-api
    environment:
      - LEETCODE_API_URL=http://leetcode-api:3000
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

---

## 🎯 **Why This Approach is Better**

### **Focused & Achievable**
- ✅ **Clear goal:** 1 problem per day
- ✅ **Simple logic:** Check, respond, repeat
- ✅ **Immediate value:** Accountability from day 1

### **Behavior-Driven**
- ✅ **Positive reinforcement:** New challenges for success
- ✅ **Gentle pressure:** Reminders without new distractions
- ✅ **Celebration:** Recognition for exceeding goals

### **Maintainable**
- ✅ **Simple codebase:** Easy to understand and modify
- ✅ **Few dependencies:** Self-hosted API + Gmail
- ✅ **Robust:** Handles the core use case extremely well

### **Scalable**
- ✅ **Easy extensions:** Can add Trello, analytics, etc. later
- ✅ **Proven foundation:** Core system is solid
- ✅ **Portfolio worthy:** Shows practical problem-solving

---

## 🚀 **Deployment Strategy**

### **Development (Week 1)**
```bash
# Local development
docker run -d -p 3000:3000 alfaarghya/alfa-leetcode-api:2.0.1
npm run dev
```

### **Production (Week 3)**
```bash
# Simple VPS deployment
git clone your-repo
cd leetcode-accountability
docker-compose up -d

# Set up cron job
echo "0 0 * * * cd /path/to/app && npm run midnight-check" | crontab -
```

---

## 💰 **Cost Analysis**

**Total Monthly Cost: $5-10**
- VPS (1GB RAM): $5-6/month
- Domain (optional): $1/month
- Gmail API: Free
- Everything else: Free

**Time Investment: 15-25 hours over 2-3 weeks**

---

## 🎯 **Success Metrics**

- ✅ **Week 1:** System sends emails based on daily LeetCode activity
- ✅ **Week 2:** 7 consecutive days of accurate accountability
- ✅ **Week 3:** Running reliably on VPS with self-hosted API
- ✅ **Ongoing:** Maintains 80%+ daily completion rate

---

## 🌟 **This System Will:**

1. **Hold you accountable** - No hiding from missed days
2. **Celebrate progress** - Recognition for good work
3. **Stay focused** - One problem at a time, no overwhelm
4. **Build habits** - Consistent daily engagement
5. **Be reliable** - Self-hosted = no external dependencies

**It's Duolingo for LeetCode, but simpler and more effective! 🎯** 

# ✨ Simplified LeetCode Tracker – CURRENT STATE

> Last updated: 2025-06-27

The tracker is now live and running from **`tracker.js`**.  
It sends exactly **one LeetCode problem per day** (02:00 cron) and repeats the same problem if it was not solved the previous day.

---
## ✅ What's Implemented

### 1. Study Plan (topics → problems)
* Loaded from `study-plan.clean.json` (generated from Trello).  
* 17 ordered topics (Arrays & Hashing → Backtracking) – 66 problems total.

### 2. Daily Routine (02:00)
1. Read `progress.json` to know yesterday's status.
2. **If yesterday's slug still unsolved** → send *Reminder* email for the same problem, do **not** advance.
3. **Else** → pick next problem in topic order and send *Today's Question* email.
4. Persist new state in `progress.json` with `solved:false`.

### 3. Submission Detection
* At the next 02:00 run, the tracker checks the last 50 accepted submissions from your self-hosted alfa-leetcode-api and flips `solved:true` if yesterday's slug is found.

### 4. Email Delivery
* Uses Gmail App-Password via Nodemailer.
* Templates implemented:
  * **Today's Question** – new problem link, topic name, difficulty.
  * **Reminder** – resends yesterday's link.

### 5. Scheduling & Runtime
* Single cron expression in `study-plan.js` → `0 2 * * *` (02:00 server time).
* `node tracker.js start` registers the cron and keeps the process alive.
* CLI helpers:
  * `node tracker.js check` – run the daily routine once.
  * `node tracker.js test`  – connectivity & email self-test.

### 6. Configuration & State Files
```
progress.json             # minimal state { lastSentDate, lastSlug, solved }
study-plan.clean.json     # Trello-derived topics → problems list
.env                      # email + API settings
```

---
## 📧 Current Email Formats

### Today's Question
```
Subject: 📝 Today's LeetCode – <Problem Title>

Topic: <Topic Name>
Your problem for today is <Problem Title> (<Difficulty>).
https://leetcode.com/problems/<slug>/
```

### Reminder (unsolved)
```
Subject: ⏰ Reminder – Yesterday's problem still pending

You didn't submit <Problem Title> yesterday.
Topic: <Topic Name>
https://leetcode.com/problems/<slug>/
```

---
## 🔜 Planned / Upcoming Features

| Feature | Status |
|---------|--------|
| Streak tracking & streak count in emails | not started |
| "Congratulations" email when goal met | not started |
| Sunday weekly summary (stats for the week) | planned |
| Catch-up queue for missed problems | planned |
| Persistent DB / dashboard | nice-to-have |
| Rate-limit / retry logic for API timeouts | backlog |

---
## 🗂 Key Source Files (current)
```
parse-trello.js        # converts Trello export → study-plan.clean.json
study-plan.js          # loads plan, converts to topics, exports helpers
tracker.js             # main engine (cron, email, progress state)
progress.json          # mutable runtime state
```

Feel free to regenerate the study plan with `parse-trello.js` if you update Trello, and restart the tracker thereafter. 