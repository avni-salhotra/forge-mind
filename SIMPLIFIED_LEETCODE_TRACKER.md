# ✨ Simplified LeetCode Tracker – CURRENT STATE

> Last updated: 2025-06-27

The tracker is now live and running from **`tracker.js`**.
It sends exactly **one LeetCode problem per day** at 02:00 (server time) and repeats the same problem if it was not solved the previous day.

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
* Uses Nodemailer with a Gmail App Password.
* Templates implemented:
  * **Today's Question** – new problem link, topic name, difficulty.
  * **Reminder** – resends yesterday's problem.

### 5. Scheduling & Runtime
* Cron expression: `0 2 * * *` (02:00 every day).
* Commands:
  * `node tracker.js start` – register cron loop.
  * `node tracker.js check` – run daily routine once.
  * `node tracker.js test` – connectivity & email smoke test.

### 6. Configuration & State Files
```
progress.json             # { lastSentDate, lastSlug, solved }
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
## 🗂 Key Source Files
```
parse-trello.js        # converts Trello export → study-plan JSON
study-plan.js          # loads plan, adds helpers (topic ordering, next slug)
tracker.js             # main engine (cron, email, progress state)
progress.json          # mutable runtime state
```

Feel free to regenerate the study plan with `parse-trello.js` if you update Trello, and restart the tracker thereafter. 