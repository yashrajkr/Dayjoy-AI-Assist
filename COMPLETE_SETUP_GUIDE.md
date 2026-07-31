# Dayjoy AI Assist — Complete Setup Guide (A to Z)

> This guide takes you from zero to deployed. Follow each step in order.
> Estimated time: 2-3 hours for local setup, 1-2 days for production.

---

## PHASE 1: GET YOUR FREE API KEYS (15 minutes)

Before touching any code, you need 3 free accounts:

### 1.1 Supabase (Free Database + Auth)
1. Go to https://supabase.com → Sign up
2. Click "New Project"
3. Name it: `dayjoy-ai`
4. Set a database password (WRITE THIS DOWN — you'll need it)
5. Choose a region close to you
6. Click "Create" — wait 2 minutes for setup
7. Once ready, go to **Settings → API**:
   - Copy **Project URL** → `https://xxxxx.supabase.co`
   - Copy **anon public key** → `eyJhbGci...` (long string)
   - Copy **service_role key** → `eyJhbGci...` (DIFFERENT long string — keep secret!)
8. Go to **Settings → Database**:
   - Copy **Connection string** → looks like: `postgresql://postgres:YOUR_PASSWORD@db.xxxxx.supabase.co:5432/postgres`

### 1.2 Groq (Free AI Engine)
1. Go to https://console.groq.com → Sign up
2. Go to **API Keys** → Create new key
3. Copy the key → `gsk_xxxxx`

### 1.3 (Optional) OpenAI (For Better Embeddings)
1. Go to https://platform.openai.com → Sign up
2. Add $5 credit (enough for months of testing)
3. Go to **API Keys** → Create new key
4. Copy the key → `sk-xxxxx`

---

## PHASE 2: DOWNLOAD AND EXTRACT (2 minutes)

### 2.1 Download the zip
Download `dayjoy-gpt-v2.13.0.zip` from the download folder.

### 2.2 Extract it
```bash
# Mac/Linux:
unzip dayjoy-gpt-v2.13.0.zip -d dayjoy
cd dayjoy

# Windows:
# Right-click the zip → Extract All → open the folder
```

---

## PHASE 3: SET UP DATABASE — RUN SQL MIGRATIONS (15 minutes)

This is the MOST IMPORTANT step. You have 13 SQL files that must run in order.

### 3.1 The SQL files (IN THIS EXACT ORDER)

```
File #1:  supabase_schema.sql           → Base tables (users, products, FAQs, etc.)
File #2:  supabase_schema_v2.sql        → Chat, notifications, feature flags
File #3:  supabase_schema_v3.sql        → Storage buckets, AI safety
File #4:  supabase_schema_v4.sql        → AI memory, integrations, push
File #5:  supabase_schema_v5.sql        → Camera, QR, OCR, push log
File #6:  supabase_schema_v6_rag.sql    → RAG: chunks, embeddings, versions
File #7:  supabase_schema_v7_admin.sql  → Admin: RBAC, AI config, training
File #8:  supabase_schema_v8_distributor.sql → Distributor: goals, customers, follow-ups
File #9:  supabase_schema_v9_customer.sql → Customer: favorites, wellness, compliance
File #10: supabase_schema_v10_analytics.sql → Analytics: alerts, dashboards, metrics
File #11: supabase_schema_v11_communication.sql → Communication: channels, campaigns, webhooks
File #12: supabase_schema_v12_workflow.sql → Workflows: agents, tasks, approvals, rules
File #13: supabase_schema_v13_security.sql → Security: devices, MFA, incidents, compliance
```

### 3.2 How to run them — METHOD A (Easiest: Supabase SQL Editor)

1. Go to your Supabase Dashboard
2. Click **SQL Editor** (left sidebar)
3. For EACH file (1 through 13):
   - Open the file from your extracted folder in a text editor
   - Copy ALL the content
   - Paste it into the Supabase SQL Editor
   - Click **RUN**
   - Wait for "Success" message
   - Move to the next file

**Run them in order: File 1 first, then File 2, then File 3... up to File 13.**

### 3.2 How to run them — METHOD B (Command line, if you have psql installed)

```bash
# Set your database URL (replace with YOUR actual connection string from Step 1.1)
export DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@db.xxxxx.supabase.co:5432/postgres"

# Run all migrations at once (the script runs them in the correct order)
chmod +x scripts/run_migrations.sh
./scripts/run_migrations.sh
```

### 3.3 Verify the database
Go to Supabase Dashboard → Table Editor. You should see 100+ tables including:
- `profiles`, `products`, `faqs`, `policies`
- `knowledge_documents`, `knowledge_chunks`, `knowledge_embeddings`
- `chat_conversations`, `chat_messages`
- `support_tickets`, `audit_logs`
- `ai_agents`, `workflows`, `task_queue`
- `security_events`, `incidents`

---

## PHASE 4: SET UP STORAGE BUCKETS (5 minutes)

### 4.1 Create storage buckets in Supabase
1. Go to Supabase Dashboard → **Storage**
2. Click **New Bucket**
3. Create these 2 buckets:
   - Name: `rag-documents` → Private → Create
   - Name: `knowledge-documents` → Private → Create

(The SQL migrations already created the storage policies, but you need to create the buckets manually)

---

## PHASE 5: INSTALL SOFTWARE (10 minutes)

### 5.1 Check you have the right software
```bash
node --version    # Must be 18+ (preferably 20+)
python3 --version # Must be 3.11+
npm --version     # Must be 9+
```

If missing:
- Node.js: https://nodejs.org/ (download LTS version)
- Python: https://python.org/ (download 3.11+)

### 5.2 Install frontend dependencies
```bash
# In the project root folder
npm install
```

### 5.3 Install backend dependencies
```bash
cd backend
pip install -r requirements.txt
cd ..
```

---

## PHASE 6: CREATE ENVIRONMENT FILES (5 minutes)

### 6.1 Frontend .env file
Create a file named `.env` in the project ROOT folder (same level as package.json):

```bash
# Replace the values with YOUR actual keys from Phase 1
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...your-anon-key...
VITE_API_BASE_URL=http://localhost:8000
```

### 6.2 Backend .env file
Create a file named `.env` inside the `backend/` folder:

```bash
# Replace with YOUR actual keys from Phase 1
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGci...your-anon-key...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...your-service-role-key...
GROQ_API_KEY=gsk_xxxxx-your-groq-key
GROQ_MODEL=llama-3.3-70b-versatile
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

# Use "local" for free testing (no OpenAI needed)
# Use "openai" for better quality (needs OPENAI_API_KEY)
RAG_EMBEDDING_PROVIDER=local
```

### 6.3 (Optional) If you have OpenAI key, add to backend/.env:
```bash
OPENAI_API_KEY=sk-xxxxx-your-openai-key
RAG_EMBEDDING_PROVIDER=openai
RAG_EMBEDDING_MODEL=text-embedding-3-small
```

---

## PHASE 7: CREATE YOUR FIRST ADMIN USER (5 minutes)

### 7.1 Create a user in Supabase
1. Go to Supabase Dashboard → **Authentication** → **Users**
2. Click **Add user**
3. Enter email: `admin@dayjoy.com` (or any email)
4. Enter password: `admin123` (or any password)
5. Click **Create user**
6. Copy the **User UID** (long string like `a1b2c3d4-...`)

### 7.2 Make them an admin
Go to Supabase Dashboard → **SQL Editor** → paste and run:

```sql
-- Replace the UUID with YOUR user's UID from step 7.1
UPDATE profiles 
SET role = 'admin', full_name = 'Dayjoy Admin' 
WHERE id = 'PASTE-YOUR-USER-UID-HERE';
```

### 7.3 Verify
Go to Supabase Dashboard → **Table Editor** → `profiles` table. You should see your user with `role = admin`.

---

## PHASE 8: START THE APPLICATION (2 minutes)

### 8.1 Start the backend (Terminal 1)
```bash
cd backend
uvicorn main:app --reload --port 8000
```

You should see:
```
Dayjoy AI Assist — Configuration Check
==============================================
✅ All required environment variables are set.
==============================================

INFO:     Uvicorn running on http://0.0.0.0:8000
```

### 8.2 Start the frontend (Terminal 2 — NEW terminal)
```bash
# In the project root folder (NOT in backend/)
npm run dev
```

You should see:
```
  VITE v6.3.5  ready in 350 ms
  ➜  Local:   http://localhost:5173/
```

### 8.3 Open the app
Open your browser: http://localhost:5173

---

## PHASE 9: TEST EVERYTHING (10 minutes)

### 9.1 Login
1. Go to http://localhost:5173/login
2. Enter the email and password you created in Phase 7
3. You should see the app

### 9.2 Test AI Chat
1. Click "New Chat"
2. Type: "What is Ashwagandha?"
3. The AI should respond (it may say it doesn't have enough info if no documents are uploaded yet)

### 9.3 Test Admin Console
1. Click "Admin Console" in the sidebar
2. You should see the Executive Dashboard
3. Navigate through: Knowledge Base, Products, FAQs, Users, Analytics

### 9.4 Test Knowledge Upload
1. Go to Admin → Knowledge Base
2. Click "Upload document"
3. Upload a PDF/DOCX/TXT file about Dayjoy products
4. The system will extract text, chunk it, and create embeddings
5. Now ask the AI about the content you uploaded

### 9.5 Check backend health
Open http://localhost:8000/health in your browser. You should see:
```json
{
  "status": "ok",
  "version": "2.13.0",
  "supabase_configured": true,
  "groq_configured": true,
  "rag_available": true
}
```

---

## PHASE 10: DEPLOY TO PRODUCTION (30-60 minutes)

### Option A: Render (Easiest — Free Tier Available)

#### 10A.1 Push to GitHub
```bash
# In your project folder
git init
git add .
git commit -m "Dayjoy AI Assist v2.13.0"
# Create a GitHub repo and push
git remote add origin https://github.com/YOUR-USERNAME/dayjoy-ai.git
git push -u origin main
```

#### 10A.2 Deploy Frontend on Render
1. Go to https://render.com → Sign up
2. New → **Static Site**
3. Connect your GitHub repo
4. Settings:
   - **Build Command**: `npm ci && npm run build:fast`
   - **Publish Directory**: `dist`
   - **Environment Variables**:
     - `VITE_SUPABASE_URL` = your Supabase URL
     - `VITE_SUPABASE_ANON_KEY` = your anon key
     - `VITE_API_BASE_URL` = `https://your-backend-name.onrender.com`
5. Click **Create Static Site**

#### 10A.3 Deploy Backend on Render
1. New → **Web Service**
2. Connect same GitHub repo
3. Settings:
   - **Root Directory**: `backend`
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT --workers 4`
   - **Health Check Path**: `/health`
   - **Environment Variables**: Add ALL variables from your `backend/.env`
4. Click **Create Web Service**

#### 10A.4 Update Frontend URL
Once the backend is deployed, copy its URL (e.g., `https://dayjoy-api.onrender.com`).
Go back to your frontend static site settings → Environment Variables → update:
- `VITE_API_BASE_URL` = `https://dayjoy-api.onrender.com`

Save and redeploy the frontend.

### Option B: Docker (For VPS)

```bash
# On your server:
git clone https://github.com/YOUR-USERNAME/dayjoy-ai.git
cd dayjoy-ai

# Create backend/.env with all your variables
nano backend/.env

# Create .env for frontend
nano .env

# Start production stack
docker compose -f docker-compose.prod.yml up -d --build

# Check if it's running
docker compose -f docker-compose.prod.yml ps
curl http://localhost:8000/health
curl http://localhost:8080
```

### Option C: Railway (Similar to Render)
1. Go to https://railway.app
2. New Project → Deploy from GitHub
3. Add two services: one for frontend (root), one for backend (backend/ folder)
4. Set environment variables in Railway dashboard
5. Railway auto-deploys on git push

---

## PHASE 11: POST-DEPLOYMENT CHECKLIST

After deployment, verify each item:

```
[ ] Frontend loads at your URL (no blank page)
[ ] Login works with your admin account
[ ] Admin dashboard shows data
[ ] AI Chat responds to messages
[ ] Knowledge upload works
[ ] /health endpoint returns {"status":"ok"}
[ ] CORS is configured (no "Access-Control-Allow-Origin" errors in browser console)
[ ] SSL is active (https:// in URL, green lock icon)
[ ] All 13 SQL migrations were applied
[ ] Storage buckets created (rag-documents, knowledge-documents)
```

---

## PHASE 12: LOAD REAL DATA (Optional but recommended)

### 12.1 Import sample products
The `data/` folder has CSV files. Import them via Supabase SQL Editor:

```sql
-- Import products (run in Supabase SQL Editor)
-- Or use Table Editor → Import CSV
```

Or manually add products via Admin → Product Database → Add Product.

### 12.2 Upload knowledge documents
1. Go to Admin → Knowledge Base
2. Upload PDFs about:
   - Dayjoy product catalog
   - Company policies
   - Training materials
   - FAQ documents
3. Approve each document (click "Approve")
4. Wait for chunking + embedding to complete

### 12.3 Create more users
1. Go to Supabase → Authentication → Users → Add user
2. Set their role in the `profiles` table:
   - `customer` — regular customer
   - `distributor` — distributor with copilot features
   - `admin` — full admin access
   - `management` — management dashboard access

---

## TROUBLESHOOTING

### "Cannot connect to backend"
- Check backend is running: `curl http://localhost:8000/health`
- Check `VITE_API_BASE_URL` in your `.env` file
- Check CORS: `ALLOWED_ORIGINS` in `backend/.env` must include your frontend URL

### "Supabase not configured"
- Check both `.env` (frontend) and `backend/.env` (backend) have correct Supabase URL and key
- Make sure there are no extra spaces or quotes in the values

### "AI says it can't answer"
- Upload documents to Knowledge Base first
- Approve the documents
- Check RAG health: `curl http://localhost:8000/rag/health`

### "tsc: not found"
- Run `npm install` first to install dependencies

### "Module not found" errors
- Backend: `cd backend && pip install -r requirements.txt`
- Frontend: `npm install`

### "Permission denied" on scripts
- Run: `chmod +x scripts/*.sh`

### Build fails with TypeScript errors
- Run: `npx tsc --noEmit` to see specific errors
- All errors should be 0 — if any appear, check you haven't modified files

### Database migration fails
- Migrations are idempotent — just re-run them
- Check the log: `cat /tmp/dayjoy_migrations.log`
- Common cause: wrong DATABASE_URL (check password, host)

---

## QUICK REFERENCE

### SQL Migration Order (13 files, run in this order)
```
1.  supabase_schema.sql
2.  supabase_schema_v2.sql
3.  supabase_schema_v3.sql
4.  supabase_schema_v4.sql
5.  supabase_schema_v5.sql
6.  supabase_schema_v6_rag.sql
7.  supabase_schema_v7_admin.sql
8.  supabase_schema_v8_distributor.sql
9.  supabase_schema_v9_customer.sql
10. supabase_schema_v10_analytics.sql
11. supabase_schema_v11_communication.sql
12. supabase_schema_v12_workflow.sql
13. supabase_schema_v13_security.sql
```

### Required Environment Variables

**Frontend (.env in root):**
```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_API_BASE_URL=http://localhost:8000
```

**Backend (backend/.env):**
```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
GROQ_API_KEY=gsk_...
ALLOWED_ORIGINS=http://localhost:5173
RAG_EMBEDDING_PROVIDER=local
```

### Commands Cheat Sheet
```bash
# Frontend
npm install          # Install dependencies
npm run dev          # Start dev server (http://localhost:5173)
npm run build        # Production build
npm run typecheck    # Check TypeScript

# Backend
cd backend
pip install -r requirements.txt  # Install Python deps
uvicorn main:app --reload --port 8000  # Start backend
python -m worker     # Start background worker

# Database
./scripts/run_migrations.sh  # Run all SQL migrations
./scripts/backup_db.sh       # Create database backup

# Docker
docker compose -f docker-compose.dev.yml up --build   # Dev
docker compose -f docker-compose.prod.yml up -d --build  # Prod
```
