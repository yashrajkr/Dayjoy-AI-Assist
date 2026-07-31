# Dayjoy AI Assist — Production Deployment Guide

> Complete guide for deploying Dayjoy AI Assist to production using Docker,
> Render, Railway, VPS, AWS, Azure, or Google Cloud.

## Prerequisites

### Required accounts
- **Supabase** — hosted PostgreSQL + Auth + Storage + Realtime
- **Groq** — LLM API (primary AI provider)
- **(Optional) OpenAI** — fallback LLM + embeddings

### Required environment variables

**Frontend** (build-time via Vite):
```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
VITE_API_BASE_URL=https://<your-backend-url>
```

**Backend** (runtime):
```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
GROQ_API_KEY=<your-groq-key>
GROQ_MODEL=llama-3.3-70b-versatile
OPENAI_API_KEY=<optional>
RAG_EMBEDDING_PROVIDER=local
ALLOWED_ORIGINS=https://your-frontend-domain.com
```

---

## Option 1: Docker Compose (Recommended for VPS)

### Quick start
```bash
# Clone the repo
git clone <your-repo-url> dayjoy
cd dayjoy

# Create backend/.env
cat > backend/.env << 'EOF'
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=<key>
SUPABASE_SERVICE_ROLE_KEY=<key>
GROQ_API_KEY=<key>
ALLOWED_ORIGINS=https://your-domain.com
EOF

# Create .env for frontend
cat > .env << 'EOF'
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<key>
VITE_API_BASE_URL=https://api.your-domain.com
EOF

# Apply database migrations
export DATABASE_URL="postgresql://<user>:<pass>@db.<ref>.supabase.co:5432/postgres"
./scripts/run_migrations.sh

# Start production stack
docker compose -f docker-compose.prod.yml up -d --build

# Verify
curl http://localhost:8000/health
curl http://localhost:8080
```

### Services
| Service | Port | Description |
|---|---|---|
| Frontend (nginx) | 8080 | Serves built React static files |
| Backend (uvicorn) | 8000 | FastAPI with 4 workers |
| Redis | 6379 (internal) | Caching + job queue |
| Worker | — | Background task processor |

### Scaling
```bash
# Scale backend workers
BACKEND_WORKERS=8 docker compose -f docker-compose.prod.yml up -d

# Scale backend instances (behind load balancer)
docker compose -f docker-compose.prod.yml up -d --scale backend=3
```

---

## Option 2: Render

### Frontend (Static Site)
1. Create a new Static Site on Render
2. Connect your GitHub repo
3. Settings:
   - **Build Command**: `npm ci && npm run build:fast`
   - **Publish Directory**: `dist`
   - **Environment Variables**: Set all `VITE_*` variables
4. Deploy

### Backend (Web Service)
1. Create a new Web Service on Render
2. Connect your GitHub repo
3. Settings:
   - **Root Directory**: `backend`
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT --workers 4`
   - **Health Check**: `/health`
   - **Environment Variables**: Set all `SUPABASE_*`, `GROQ_*`, `ALLOWED_ORIGINS`
4. Deploy

### Worker (Background Worker)
1. Create a Background Worker on Render
2. Settings:
   - **Root Directory**: `backend`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python -m backend.worker`
3. Deploy

---

## Option 3: Railway

### Frontend
```bash
railway new --template vite
# Set VITE_* env vars in Railway dashboard
# Build: npm ci && npm run build:fast
# Serve: dist/
```

### Backend
```bash
railway new
# Root: backend
# Build: pip install -r requirements.txt
# Start: uvicorn main:app --host 0.0.0.0 --port $PORT --workers 4
# Set all env vars in Railway dashboard
```

---

## Option 4: VPS (Ubuntu/Debian)

### Install Docker
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

### Deploy
```bash
# Clone and configure
git clone <repo> /opt/dayjoy
cd /opt/dayjoy

# Create .env files
nano backend/.env
nano .env

# Apply migrations
export DATABASE_URL="postgresql://..."
./scripts/run_migrations.sh

# Start
docker compose -f docker-compose.prod.yml up -d --build

# Set up Nginx reverse proxy + SSL
sudo apt install nginx certbot python3-certbot-nginx
sudo nano /etc/nginx/sites-available/dayjoy
```

### Nginx reverse proxy config
```nginx
server {
    server_name your-domain.com;
    location / {
        proxy_pass http://localhost:8080;
    }
    location /api {
        proxy_pass http://localhost:8000;
    }
}
server {
    server_name api.your-domain.com;
    location / {
        proxy_pass http://localhost:8000;
    }
}
```

### SSL
```bash
sudo certbot --nginx -d your-domain.com -d api.your-domain.com
```

---

## Option 5: AWS (ECS + RDS)

### Architecture
- **Frontend**: S3 + CloudFront (static hosting)
- **Backend**: ECS Fargate (2+ tasks)
- **Redis**: ElastiCache
- **Database**: Supabase (or RDS PostgreSQL)
- **Load Balancer**: Application Load Balancer

### Steps
1. Build and push Docker images to ECR
2. Create ECS task definitions for backend + worker
3. Create ALB with health check path `/health`
4. Configure auto-scaling (CPU > 70% → scale out)
5. Set up CloudFront for frontend S3 bucket

---

## Database Migrations

```bash
# Set DATABASE_URL
export DATABASE_URL="postgresql://user:pass@host:5432/dbname"

# Run all migrations (idempotent — safe to re-run)
./scripts/run_migrations.sh

# Verify
psql $DATABASE_URL -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
# Should show 160+ tables
```

---

## Backup & Recovery

### Automated backup
```bash
# Set DATABASE_URL
export DATABASE_URL="postgresql://..."

# Create backup
./scripts/backup_db.sh

# Backups stored in ./backups/ with timestamp + checksum
# Keeps last 30 backups automatically
```

### Restore
```bash
gunzip -c backups/dayjoy_backup_YYYYMMDD_HHMMSS.sql.gz | psql $DATABASE_URL
```

### Schedule daily backup (cron)
```bash
crontab -e
# Add: 0 2 * * * cd /opt/dayjoy && ./scripts/backup_db.sh >> /var/log/dayjoy_backup.log 2>&1
```

---

## Health Checks

| Endpoint | Purpose | Expected Response |
|---|---|---|
| `GET /health` | Liveness | `{"status":"ok","version":"2.12.0"}` |
| `GET /rag/health` | RAG subsystem | `{"status":"ok","rag_available":true}` |
| `GET /analytics/health` | System health | Full health dashboard |
| `GET /security/dashboard` | Security dashboard | Risk score + KPIs |

---

## Monitoring

### Docker logs
```bash
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs -f worker
```

### Load testing
```bash
python scripts/load_test.py --base-url http://localhost:8000 --duration 60 --concurrency 10
```

---

## Post-Deployment Checklist

- [ ] Database migrations applied (`./scripts/run_migrations.sh`)
- [ ] Supabase storage buckets created (`rag-documents`, `knowledge-documents`)
- [ ] Supabase Auth providers configured (Email + Google if needed)
- [ ] Environment variables set (all required + optional)
- [ ] CORS origins configured (`ALLOWED_ORIGINS`)
- [ ] Health check passing (`curl https://api.your-domain.com/health`)
- [ ] Frontend loads (`curl https://your-domain.com`)
- [ ] SSL certificates active
- [ ] Backup cron job configured
- [ ] Background worker running
- [ ] Rate limiting active (test with rapid requests)
- [ ] RAG subsystem healthy (`curl https://api.your-domain.com/rag/health`)
- [ ] Admin console accessible at `/admin`
- [ ] User login works (test with real Supabase user)
- [ ] Chat endpoint works (send a test message)

---

## Troubleshooting

### Backend won't start
```bash
# Check logs
docker compose -f docker-compose.prod.yml logs backend

# Common issues:
# - Missing env vars → check backend/.env
# - Supabase URL wrong → check SUPABASE_URL
# - Port conflict → change BACKEND_PORT
```

### Frontend shows blank page
```bash
# Check if build succeeded
docker compose -f docker-compose.prod.yml logs frontend

# Check VITE_* env vars were set at build time
# (Vite injects them during build, not at runtime)
```

### Database connection fails
```bash
# Test connection
psql $DATABASE_URL -c "SELECT 1;"

# Check Supabase project is not paused
# Check IP restrictions in Supabase dashboard
```

### Worker not processing tasks
```bash
# Check worker logs
docker compose -f docker-compose.prod.yml logs worker

# Verify Redis is healthy
docker compose -f docker-compose.prod.yml exec redis redis-cli ping
```
