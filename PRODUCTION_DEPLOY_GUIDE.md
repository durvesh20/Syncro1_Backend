# Production Deployment Guide — BullMQ + Redis on Hostinger VPS
### Server already has: Nginx ✅ | PM2 ✅ | Node ✅

---

## What You Need To Do (Overview)

```
1. SSH into your VPS
2. Install & harden Redis
3. Update .env.production with Redis URL
4. Push code from local → GitHub → VPS
5. Update PM2 ecosystem file (instances: 1)
6. Restart with PM2
7. Protect Bull Board in Nginx
8. Verify everything works
```

---

## STEP 1 — SSH Into Your VPS

```bash
ssh root@YOUR_VPS_IP
# or
ssh your-username@YOUR_VPS_IP
```

---

## STEP 2 — Install Redis on VPS

```bash
# Install
sudo apt-get update
sudo apt-get install -y redis-server

# Verify
redis-cli ping   # → PONG
```

---

## STEP 3 — Harden Redis for Production

```bash
sudo nano /etc/redis/redis.conf
```

Find and change these lines (use `Ctrl+W` to search):

```conf
# 1. Bind to localhost ONLY (never expose Redis to internet)
bind 127.0.0.1 -::1

# 2. Set a strong password (remember this — you'll need it in .env)
requirepass Syncro1Redis@2025!

# 3. Disable dangerous commands
rename-command FLUSHALL ""
rename-command FLUSHDB ""
rename-command DEBUG ""
rename-command CONFIG ""

# 4. Set max memory (change 256mb based on your VPS RAM)
maxmemory 256mb
maxmemory-policy allkeys-lru

# 5. Enable persistence (save to disk on crash)
save 900 1
save 300 10
save 60 10000
```

Save file: `Ctrl+X` → `Y` → `Enter`

```bash
# Restart Redis with new config
sudo systemctl restart redis-server

# Enable auto-start on server reboot
sudo systemctl enable redis-server

# Test with password
redis-cli -a "Syncro1Redis@2025!" ping   # → PONG
```

---

## STEP 4 — Update .env.production on Your LOCAL Machine

Open `.env.production` in your backend:

```env
# ==================== REDIS (BullMQ) ====================
REDIS_URL=redis://:Syncro1Redis@2025!@127.0.0.1:6379
AI_WORKER_CONCURRENCY=3
```

> ⚠️ Format: `redis://:PASSWORD@127.0.0.1:6379`
> The colon `:` before the password is mandatory!

---

## STEP 5 — Push Code to GitHub (from your local machine)

```bash
cd /run/media/yogesh/48baf8b0-8ae7-40cf-868c-a10a28da42ab/Syncro1/Syncro1_Backend

git add .
git commit -m "feat: BullMQ + Redis AI queue - production ready"
git push origin main
```

---

## STEP 6 — Pull Code on VPS

```bash
# SSH into VPS first (if not already)
ssh root@YOUR_VPS_IP

# Go to your backend directory (adjust path to your actual path)
cd /var/www/syncro1-backend
# OR wherever your backend lives, common paths:
# cd ~/syncro1-backend
# cd /home/username/syncro1-backend

# Pull latest code
git pull origin main

# Install new dependencies (bullmq + ioredis already in package.json)
npm install

# Verify new files exist
ls queues/          # should show: aiQueue.js  aiWorker.js  bullBoardSetup.js
ls models/AiJobLog.js
ls config/redis.js
```

---

## STEP 7 — Update .env on VPS

The `.env.production` is in git, BUT your API keys are secret.
Either:

**Option A — Edit directly on VPS:**
```bash
nano .env.production
# Add/update:
# REDIS_URL=redis://:Syncro1Redis@2025!@127.0.0.1:6379
# AI_WORKER_CONCURRENCY=3
```

**Option B — If you use a .env file not in git:**
```bash
nano .env
# Same additions
```

---

## STEP 8 — Update PM2 Configuration

This is CRITICAL. You must run only 1 instance (not cluster mode).

Check your current PM2 setup:
```bash
pm2 list
pm2 show syncro1-backend   # see current config
```

### Option A — If you start with `pm2 start server.js`

```bash
# Stop old process
pm2 stop syncro1-backend
pm2 delete syncro1-backend

# Start fresh (single instance, fork mode)
NODE_ENV=production pm2 start server.js \
  --name "syncro1-backend" \
  --instances 1 \
  --exec-mode fork

pm2 save
```

### Option B — If you use ecosystem.config.js (recommended)

Create/update `ecosystem.config.js` in your backend root:

```bash
nano ecosystem.config.js
```

Paste this:

```javascript
module.exports = {
  apps: [
    {
      name: 'syncro1-backend',
      script: 'server.js',
      instances: 1,           // ← MUST BE 1 — never use cluster with BullMQ Worker
      exec_mode: 'fork',      // ← NOT 'cluster'
      env_production: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
      watch: false,
      max_memory_restart: '500M',
      // Restart policy
      restart_delay: 3000,
      max_restarts: 10,
      // Logs
      out_file: '/var/log/pm2/syncro1-out.log',
      error_file: '/var/log/pm2/syncro1-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
```

```bash
# Create log directory
mkdir -p /var/log/pm2

# Stop old process and start with ecosystem file
pm2 stop syncro1-backend
pm2 delete syncro1-backend
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup   # ← follow the printed command to enable auto-start on reboot
```

---

## STEP 9 — Verify Server Started Correctly

```bash
# Watch live logs
pm2 logs syncro1-backend --lines 50

# You MUST see these lines in the logs:
# [AI Worker] 🚀 Starting with concurrency=3 on queue "ai-processing"
# [AI Worker] ✅ Listening on queue "ai-processing"
# [Bull Board] ✅ Dashboard available at /admin/queues
# 🚀 Server running in production mode on port 5000

# If you see Redis errors:
# [Redis] Not connected — make sure Redis is running
# → Fix: sudo systemctl start redis-server
```

---

## STEP 10 — Protect Bull Board in Nginx

Bull Board UI is at `/admin/queues`. Protect it in your Nginx config.

```bash
sudo nano /etc/nginx/sites-available/syncro1
# OR wherever your Nginx config is:
# sudo nano /etc/nginx/sites-available/default
# sudo nano /etc/nginx/conf.d/syncro1.conf
```

Find your `location /` block and add the Bull Board block:

```nginx
server {
    listen 80;
    server_name api.syncro1.com;    # ← your actual API domain

    # Main API — proxy to Node
    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 120s;
        proxy_connect_timeout 10s;
    }

    # Bull Board — restrict to your office/home IP only
    location /admin/queues {
        proxy_pass http://localhost:5000/admin/queues;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # ⚠️ IMPORTANT: Restrict access to your IP only
        allow YOUR_HOME_IP;       # e.g. 103.xx.xx.xx
        allow YOUR_OFFICE_IP;     # add as many as needed
        deny all;                 # block everyone else
    }
}
```

```bash
# Test Nginx config
sudo nginx -t

# If test passes, reload
sudo systemctl reload nginx
```

---

## STEP 11 — Full Verification Checklist

Run these checks after deployment:

### ✅ Redis is running
```bash
sudo systemctl status redis-server   # → active (running)
redis-cli -a "Syncro1Redis@2025!" ping   # → PONG
```

### ✅ Backend is running
```bash
pm2 status                           # → syncro1-backend | online
curl http://localhost:5000/api/health
# → { "success": true, "message": "Server is running" }
```

### ✅ Queue is connected
```bash
curl http://localhost:5000/api/health/queue
# → { "success": true, "queue": "ai-processing", "stats": { "waiting": 0, ... } }
```

### ✅ Logs look clean
```bash
pm2 logs syncro1-backend --lines 30
# Should see Worker started, NO Redis connection errors
```

### ✅ Bull Board accessible (from your IP)
```
https://api.syncro1.com/admin/queues
→ Login with admin account
→ See queue dashboard
```

---

## Day-to-Day Operations on VPS

### Deploy new code
```bash
cd /var/www/syncro1-backend
git pull origin main
npm install              # only if package.json changed
pm2 restart syncro1-backend
pm2 logs syncro1-backend --lines 30   # check for errors
```

### Check queue health
```bash
# API endpoint
curl https://api.syncro1.com/api/health/queue

# Redis directly
redis-cli -a "Syncro1Redis@2025!" info memory
redis-cli -a "Syncro1Redis@2025!" LLEN bull:ai-processing:wait
```

### View failed AI jobs
```bash
pm2 logs syncro1-backend | grep "failed"
# OR check MongoDB AiJobLog collection
```

### Emergency — clear stuck jobs
```bash
redis-cli -a "Syncro1Redis@2025!" DEL "bull:ai-processing:active"
pm2 restart syncro1-backend
```

### Restart everything after VPS reboot
```bash
# Redis auto-starts (systemctl enable)
# PM2 auto-starts (pm2 startup)
# Nginx auto-starts
# Nothing manual needed ✅
```

---

## Troubleshooting on Production

| Error in logs | Cause | Fix |
|---|---|---|
| `connect ECONNREFUSED 127.0.0.1:6379` | Redis not running | `sudo systemctl start redis-server` |
| `WRONGPASS invalid username-password pair` | Wrong password in REDIS_URL | Check `.env.production` REDIS_URL password |
| `EADDRINUSE :::5000` | Old process still alive | `kill -9 $(lsof -ti :5000)` then `pm2 restart` |
| Jobs stuck in `active` | Worker crashed mid-job | `pm2 restart syncro1-backend` — BullMQ auto-retries |
| Bull Board shows blank | Auth failed or wrong IP | Login as admin first, or check Nginx `allow` IP |
| High Redis memory | Too many completed jobs | `redis-cli -a PASS DEL bull:ai-processing:completed` |

---

## ⚠️ Critical Rules — Never Break These

1. **NEVER** set `instances > 1` in PM2 for this backend — multiple Workers = duplicate AI calls
2. **NEVER** expose Redis port 6379 in your firewall — it must be localhost-only
3. **ALWAYS** set `requirepass` in Redis config on production
4. **ALWAYS** run `pm2 save` after any PM2 change — otherwise config is lost on reboot

---

*Syncro1 Backend — Production BullMQ Guide | Updated: 2026-07-30*
