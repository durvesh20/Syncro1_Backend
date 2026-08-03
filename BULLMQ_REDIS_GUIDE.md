# BullMQ + Redis — Architecture, Operations & Production Guide
### Syncro1 Backend — AI Job Queue System

---

## Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [How It Works — Step by Step](#2-how-it-works--step-by-step)
3. [File Map](#3-file-map)
4. [Local Development — Start & Stop](#4-local-development--start--stop)
5. [Common Issues & Fixes](#5-common-issues--fixes)
6. [Production Setup on Hostinger VPS](#6-production-setup-on-hostinger-vps)
7. [Monitoring & Observability](#7-monitoring--observability)
8. [Environment Variables Reference](#8-environment-variables-reference)
9. [Cheat Sheet](#9-cheat-sheet)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CANDIDATE FLOW                           │
└─────────────────────────────────────────────────────────────────┘

  WhatsApp Consent (candidate clicks "I Agree")
           │
           ▼
  candidateRoutes.js  ──►  enqueueAIJob(candidateId)
  (HTTP returns 202 instantly)          │
                                        │  Adds job to Redis
                                        ▼
                          ┌─────────────────────────┐
                          │   Redis (localhost:6379)  │
                          │   Queue: "ai-processing" │
                          │   ┌──────────────────┐  │
                          │   │  Job 1 (waiting)  │  │
                          │   │  Job 2 (waiting)  │  │
                          │   │  Job 3 (waiting)  │  │
                          │   └──────────────────┘  │
                          └────────────┬────────────┘
                                       │ Worker polls
                                       ▼
                          ┌─────────────────────────┐
                          │    aiWorker.js            │
                          │    concurrency = 3        │
                          │    ┌───┐ ┌───┐ ┌───┐    │
                          │    │ W1│ │ W2│ │ W3│    │  ← 3 parallel slots
                          │    └─┬─┘ └─┬─┘ └─┬─┘    │
                          └──────┼──────┼──────┼─────┘
                                 │      │      │
                                 ▼      ▼      ▼
                          processAfterConsent(candidateId)
                                 │
                                 ├── aiService.parseResume()  ──► OpenAI GPT-5
                                 ├── Score candidate (0–100)
                                 ├── Save to MongoDB
                                 ├── Notify admin
                                 └── Log to AiJobLog (MongoDB)
```

### Why BullMQ + Redis?

| Problem (Before) | Solution (After) |
|---|---|
| 30+ simultaneous OpenAI calls → rate limit | Queue serializes/limits calls to 3 at a time |
| HTTP request blocks for 30–60s waiting on AI | HTTP returns `202 Accepted` in <100ms |
| Silent AI failure = wasted OpenAI tokens | 3 retries with exponential backoff (5s→10s→20s) |
| No way to know if AI finished | AiJobLog in MongoDB + Bull Board UI |
| Server crash = job lost | Jobs persisted in Redis — survive restarts |

---

## 2. How It Works — Step by Step

### When a candidate gives WhatsApp consent:

```
1. Candidate clicks "I Agree" on WhatsApp link
2. candidateRoutes.js /consent/agree route fires
3. candidate.status → CONSENT_CONFIRMED (saved to MongoDB)
4. enqueueAIJob(candidateId) adds a job to Redis queue
   → Returns { jobId: "123" } immediately
5. HTTP response sent to WhatsApp webhook: { success: true }
   (Total time: ~50ms)

--- Background Worker picks up the job ---

6. aiWorker.js picks up job from Redis
7. AiJobLog entry created: status = 'active'
8. candidateQueueService.processAfterConsent() runs:
   a. Fetch candidate + job from MongoDB
   b. candidate.status → ADMIN_REVIEW (saved)
   c. aiService.parseResume() → calls OpenAI GPT-5
   d. Score candidate (skills, exp, salary, location...)
   e. Save score + analysis to candidate.resumeAnalysis
   f. Notify admin/subadmin
9. AiJobLog updated: status = 'completed', durationMs, aiScore
10. Job removed from Redis queue
```

### On Failure:
```
If step 8c fails (OpenAI error / timeout):
  → BullMQ retries after 5 seconds (attempt 2)
  → If fails again, retries after 10 seconds (attempt 3)
  → If all 3 attempts fail:
      → AiJobLog: status = 'failed'
      → candidate.resumeAnalysis.aiStatus = 'FAILED'
      → Admin sees candidate in queue for manual review
```

---

## 3. File Map

```
Syncro1_Backend/
├── config/
│   ├── ai.js                    ← OpenAI client init
│   └── redis.js                 ← [NEW] ioredis connection factory
│
├── queues/
│   ├── aiQueue.js               ← [NEW] BullMQ Queue + enqueueAIJob()
│   ├── aiWorker.js              ← [NEW] BullMQ Worker (concurrency=3)
│   └── bullBoardSetup.js        ← [NEW] Bull Board dashboard UI
│
├── models/
│   └── AiJobLog.js              ← [NEW] MongoDB job lifecycle log
│
├── services/
│   └── candidateQueueService.js ← [MODIFIED] Added enqueueAIJob()
│
├── routes/
│   └── candidateRoutes.js       ← [MODIFIED] Uses enqueueAIJob
│
├── server.js                    ← [MODIFIED] Boots worker + Bull Board
│
├── .env.development             ← REDIS_URL + AI_WORKER_CONCURRENCY
└── .env.production              ← REDIS_URL (prod Redis) + concurrency
```

### Key Classes / Functions

| Symbol | File | Role |
|---|---|---|
| `enqueueAIJob(candidateId)` | `queues/aiQueue.js` | Add job to queue → returns `{ jobId }` |
| `getQueueStats()` | `queues/aiQueue.js` | Get waiting/active/failed counts |
| `startAIWorker()` | `queues/aiWorker.js` | Start background worker process |
| `stopAIWorker()` | `queues/aiWorker.js` | Graceful shutdown |
| `getBullBoardRouter()` | `queues/bullBoardSetup.js` | Express router for queue UI |
| `processAfterConsent()` | `services/candidateQueueService.js` | Actual AI pipeline (called by Worker) |

---

## 4. Local Development — Start & Stop

### Prerequisites

```bash
# Check if Redis is installed
redis-server --version

# Install if missing (Ubuntu / Debian / WSL)
sudo apt-get update && sudo apt-get install -y redis-server

# Install if missing (macOS with Homebrew)
brew install redis
```

### Start Redis Locally

```bash
# Option 1: Start as a background service (recommended)
sudo systemctl start redis-server
sudo systemctl enable redis-server   # auto-start on boot

# Option 2: Start in foreground (see logs in terminal)
redis-server

# Option 3: Custom config
redis-server /etc/redis/redis.conf

# Verify it's running
redis-cli ping         # → PONG
redis-cli info server  # → detailed info
```

### Stop Redis Locally

```bash
# If running as systemd service
sudo systemctl stop redis-server

# If running in foreground
Ctrl+C

# Force stop (only if stuck)
redis-cli shutdown
# OR
sudo pkill redis-server
```

### Start the Backend (Development)

```bash
cd /path/to/Syncro1_Backend
npm run dev    # nodemon server.js
```

**You should see in the console:**
```
✅ Loaded .env.development
🤖 AI: OpenAI configured successfully
[AI Worker] 🚀 Starting with concurrency=3 on queue "ai-processing"
[AI Worker] ✅ Listening on queue "ai-processing"
[Bull Board] ✅ Dashboard available at /admin/queues
🚀 Server running on port 5000
```

### Stop the Backend

```bash
Ctrl+C
# Worker shuts down gracefully (SIGINT handler in server.js)
```

### Check Queue Status (Local)

```bash
# Quick HTTP check
curl http://localhost:5000/api/health/queue

# Redis CLI inspection
redis-cli
  > KEYS bull:ai-processing:*    # all BullMQ keys
  > LLEN bull:ai-processing:wait # jobs waiting
  > ZCARD bull:ai-processing:active

# Bull Board UI (requires admin login)
open http://localhost:5000/admin/queues
```

### Flush Queue (Dev Only — Dangerous in Prod!)

```bash
redis-cli
  > DEL bull:ai-processing:wait
  > DEL bull:ai-processing:active
  # OR flush everything:
  > FLUSHALL   ← ⚠️ deletes ALL redis data
```

---

## 5. Common Issues & Fixes

### ❌ Issue 1: `Error: connect ECONNREFUSED 127.0.0.1:6379`

**Cause:** Redis is not running.

```bash
# Fix:
sudo systemctl start redis-server
redis-cli ping   # should return PONG
```

---

### ❌ Issue 2: `MaxRetriesPerRequestError` or `ReplyError: READONLY`

**Cause:** BullMQ requires `maxRetriesPerRequest: null` — was probably set to a number, or you're connecting to a Redis replica instead of the master.

```bash
# Fix: Check config/redis.js — ensure:
maxRetriesPerRequest: null,
enableReadyCheck: false,
```

---

### ❌ Issue 3: Jobs stuck in `active` forever (stalled)

**Cause:** Worker process was killed without graceful shutdown while processing a job. BullMQ marks it "stalled" after `stalledInterval` (30s) and retries.

```bash
# Check stalled jobs in Bull Board UI → Failed tab
# OR via Redis CLI:
redis-cli ZRANGE bull:ai-processing:stalled 0 -1

# Fix: Restart the worker — BullMQ will auto-retry stalled jobs
npm run dev
```

---

### ❌ Issue 4: Jobs in `failed` state — all retries exhausted

**Cause:** OpenAI API error, invalid resume URL, or MongoDB timeout.

```bash
# Check AiJobLog in MongoDB:
db.aijoblogs.find({ status: 'failed' }).sort({ createdAt: -1 }).limit(10)

# Check Bull Board UI → Failed tab for error messages

# Retry specific failed job from Bull Board UI:
#   Click job → "Retry" button

# Retry ALL failed jobs via Redis CLI:
redis-cli
  > EVAL "local jobs=redis.call('ZRANGE','bull:ai-processing:failed',0,-1) for _,id in ipairs(jobs) do redis.call('LPUSH','bull:ai-processing:wait',id) end return #jobs" 0
```

---

### ❌ Issue 5: Memory growing too large in Redis

**Cause:** Completed/failed jobs accumulating.

BullMQ auto-cleans via `removeOnComplete` and `removeOnFail` (configured in `aiQueue.js`).  
If Redis memory is still growing, manually clean up:

```bash
redis-cli
  > MEMORY USAGE bull:ai-processing:completed
  # If too large:
  > DEL bull:ai-processing:completed
```

Also set Redis `maxmemory` in `/etc/redis/redis.conf`:
```
maxmemory 256mb
maxmemory-policy allkeys-lru
```

---

### ❌ Issue 6: Bull Board UI shows blank / CORS error

**Cause:** The `/admin/queues` route requires admin auth (`protect + authorize('admin')`).

```bash
# Fix: Make sure you're logged in as an admin before visiting /admin/queues
# OR temporarily remove auth middleware for local debugging:
app.use('/admin/queues', getBullBoardRouter());  # ← dev only, revert after!
```

---

### ❌ Issue 7: Worker processes job twice (duplicate processing)

**Cause:** Multiple server instances running (e.g., nodemon restarted mid-job).

BullMQ handles this with **job locking** (5-minute lock duration set in `aiWorker.js`). If you see duplicates, check that only ONE instance of the worker is running:

```bash
ps aux | grep "node server.js"
# Kill extras if needed
kill <PID>
```

---

### ❌ Issue 8: `EADDRINUSE :::5000` on server restart

**Cause:** Previous server didn't shut down cleanly.

```bash
# Find and kill the process using port 5000
lsof -ti :5000 | xargs kill -9
# Then restart
npm run dev
```

---

## 6. Production Setup on Hostinger VPS

### Step 1 — SSH into your VPS

```bash
ssh root@your-hostinger-vps-ip
# OR
ssh username@your-hostinger-vps-ip
```

---

### Step 2 — Install Redis on the VPS

```bash
sudo apt-get update
sudo apt-get install -y redis-server

# Configure Redis for production
sudo nano /etc/redis/redis.conf
```

**Key settings to change in `redis.conf`:**
```conf
# Bind to localhost only (never expose Redis to the internet!)
bind 127.0.0.1

# Set a strong password
requirepass YourStrongRedisPassword123!

# Persistence — save to disk in case of crash
save 900 1
save 300 10
save 60 10000

# Max memory (adjust based on your VPS RAM)
maxmemory 512mb
maxmemory-policy allkeys-lru

# Log file
logfile /var/log/redis/redis-server.log
```

```bash
# Restart Redis with new config
sudo systemctl restart redis-server
sudo systemctl enable redis-server    # auto-start on boot

# Test with password
redis-cli -a YourStrongRedisPassword123! ping   # → PONG
```

---

### Step 3 — Update `.env.production`

```env
# ==================== REDIS (BullMQ) ====================
REDIS_URL=redis://:YourStrongRedisPassword123!@127.0.0.1:6379
AI_WORKER_CONCURRENCY=3
```

> [!IMPORTANT]
> The URL format with password is: `redis://:PASSWORD@HOST:PORT`  
> Note the colon `:` before the password — that's required.

---

### Step 4 — Upload Backend to VPS

```bash
# On your local machine — push to GitHub
cd /path/to/Syncro1_Backend
git add .
git commit -m "feat: BullMQ + Redis AI queue"
git push origin main

# On VPS — pull the latest
cd /var/www/syncro1-backend   # or wherever your backend lives
git pull origin main
npm install    # installs bullmq, ioredis (already in package.json)
```

---

### Step 5 — Set Up PM2 (Process Manager)

PM2 keeps your Node.js server alive after crashes and restarts it on reboot.

```bash
# Install PM2 globally
npm install -g pm2

# Start the backend
NODE_ENV=production pm2 start server.js --name "syncro1-backend"

# Monitor logs
pm2 logs syncro1-backend
pm2 monit   # live dashboard

# Save PM2 process list (survives VPS reboot)
pm2 save
pm2 startup   # follow the printed instructions to enable auto-start
```

---

### Step 6 — Create PM2 ecosystem file (recommended)

Create `ecosystem.config.js` in your backend root:

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'syncro1-backend',
      script: 'server.js',
      instances: 1,          // ← KEEP AT 1 (single worker instance)
      exec_mode: 'fork',     // ← NOT 'cluster' — BullMQ worker must be single
      env_production: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
      // Auto-restart on crash
      watch: false,
      max_memory_restart: '500M',
      // Log files
      out_file: '/var/log/pm2/syncro1-out.log',
      error_file: '/var/log/pm2/syncro1-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
```

```bash
# Start using ecosystem file
pm2 start ecosystem.config.js --env production
pm2 save
```

> [!WARNING]
> **DO NOT use `pm2 start server.js --instances 2`** (cluster mode)  
> Running multiple server instances means multiple Workers, which means multiple  
> OpenAI calls per job. Always use `instances: 1` or run the Worker in a separate process.

---

### Step 7 — Nginx Reverse Proxy (if using Nginx)

Add to your Nginx config (usually `/etc/nginx/sites-available/syncro1`):

```nginx
server {
    listen 80;
    server_name api.syncro1.com;   # your domain

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 120s;    # ← increase for long AI requests
        proxy_connect_timeout 10s;
    }

    # Bull Board (restrict to VPN/admin IPs if possible)
    location /admin/queues {
        proxy_pass http://localhost:5000/admin/queues;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        # Optional: restrict by IP
        # allow 1.2.3.4;  # your office/home IP
        # deny all;
    }
}
```

```bash
sudo nginx -t          # test config
sudo systemctl reload nginx
```

---

### Step 8 — Production Operations

```bash
# Restart backend (e.g., after code update)
cd /var/www/syncro1-backend
git pull origin main
npm install
pm2 restart syncro1-backend

# Stop backend
pm2 stop syncro1-backend

# View real-time logs
pm2 logs syncro1-backend --lines 100

# Check Redis on production
redis-cli -a YourStrongRedisPassword123! ping
redis-cli -a YourStrongRedisPassword123! info memory

# Check queue stats from API
curl https://api.syncro1.com/api/health/queue
```

---

### Production Security Checklist

| Item | Status |
|---|---|
| Redis bound to `127.0.0.1` (not `0.0.0.0`) | ✅ Must do |
| Redis password set (`requirepass`) | ✅ Must do |
| Redis not exposed on public firewall | ✅ Must do |
| Bull Board route behind admin auth | ✅ Done in code |
| Bull Board route IP-restricted in Nginx | ⭐ Recommended |
| Redis maxmemory set | ✅ Recommended |
| PM2 `instances: 1` (single Worker) | ✅ Must do |
| PM2 startup enabled (survives reboot) | ✅ Must do |

---

## 7. Monitoring & Observability

### Bull Board UI
- **URL:** `http://localhost:5000/admin/queues` (dev) / `https://api.syncro1.com/admin/queues` (prod)
- **Requires:** Admin login
- **Shows:** Waiting, Active, Completed, Failed, Delayed jobs with full job data

### Queue Health API
```bash
GET /api/health/queue
# Response:
{
  "success": true,
  "queue": "ai-processing",
  "stats": {
    "waiting": 0,
    "active": 1,
    "completed": 42,
    "failed": 2,
    "delayed": 0
  }
}
```

### MongoDB — AiJobLog Collection
```javascript
// Find all failed jobs (last 24h)
db.aijoblogs.find({
  status: 'failed',
  createdAt: { $gte: new Date(Date.now() - 86400000) }
}).sort({ createdAt: -1 })

// Average AI processing time
db.aijoblogs.aggregate([
  { $match: { status: 'completed' } },
  { $group: { _id: null, avgDuration: { $avg: '$durationMs' } } }
])

// Token usage by day
db.aijoblogs.aggregate([
  { $match: { status: 'completed', tokensUsed: { $exists: true } } },
  { $group: {
      _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
      totalTokens: { $sum: '$tokensUsed' },
      count: { $sum: 1 }
  }},
  { $sort: { _id: -1 } }
])
```

### PM2 Monitoring (Production)
```bash
pm2 monit              # live CPU/RAM dashboard
pm2 logs --lines 50    # last 50 log lines
pm2 status             # all processes status
```

---

## 8. Environment Variables Reference

| Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `AI_WORKER_CONCURRENCY` | `3` | Parallel AI jobs the Worker processes |
| `AI_ENABLED` | `true` | Enable/disable OpenAI calls |
| `OPENAI_API_KEY` | — | Your OpenAI API key |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI model to use |

### REDIS_URL formats

```bash
# No password (local dev)
REDIS_URL=redis://localhost:6379

# With password (production)
REDIS_URL=redis://:YourPassword@127.0.0.1:6379

# Custom DB number (to separate from other Redis data)
REDIS_URL=redis://:YourPassword@127.0.0.1:6379/1

# If using Redis on a different host (e.g., Redis Cloud, ElastiCache)
REDIS_URL=redis://:YourPassword@redis.your-host.com:6379
```

---

## 9. Cheat Sheet

### Local Dev
```bash
# Start Redis
sudo systemctl start redis-server

# Start backend
cd Syncro1_Backend && npm run dev

# Check queue
curl http://localhost:5000/api/health/queue

# Stop Redis
sudo systemctl stop redis-server
```

### Production (Hostinger VPS)
```bash
# Deploy new code
git pull && npm install && pm2 restart syncro1-backend

# Check status
pm2 status
pm2 logs syncro1-backend --lines 50
curl https://api.syncro1.com/api/health/queue
redis-cli -a PASSWORD ping

# Redis service
sudo systemctl start redis-server
sudo systemctl stop redis-server
sudo systemctl status redis-server

# Emergency: clear a stuck queue
redis-cli -a PASSWORD DEL bull:ai-processing:active
pm2 restart syncro1-backend
```

### Job Retry / Recovery
```bash
# Retry all failed jobs via Bull Board UI:
http://localhost:5000/admin/queues → Failed tab → "Retry All"

# OR manually via Redis CLI (dev only):
redis-cli LRANGE bull:ai-processing:failed 0 -1
```

---

*Generated: 2026-07-30 | Syncro1 Backend v1.0 | BullMQ v5 + ioredis v5*
