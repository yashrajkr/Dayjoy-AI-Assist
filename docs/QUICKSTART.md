# Dayjoy AI Assist — Quickstart Guide

> **One file. Everything you need to verify the app works.**
> This guide walks you from zip → running app in under 5 minutes.

---

## What's in the Zip

```
Dayjoy-AI-Assist-v2.0.0-Complete.zip
├── src/                              # Frontend source (React + Vite + TS)
├── backend/                          # FastAPI backend (Python)
│   ├── main.py                       #   All API endpoints
│   ├── requirements.txt              #   Python deps
│   └── Dockerfile
├── public/                           # PWA manifest + service worker
├── data/                             # CSV seed data (products, FAQs, etc.)
├── supabase_schema.sql               # Initial schema (43 tables)
├── supabase_schema_v2.sql            # +auth +RLS
├── supabase_schema_v3.sql            # +audit logs
├── supabase_schema_v4.sql            # +integrations +user_preferences +push_subscriptions
├── supabase_schema_v5.sql            # +camera/QR/OCR tables +storage bucket (NEW)
├── supabase_schema_complete.sql      # ALL 5 schemas in ONE file ← run this
├── supabase_knowledge_base_seed.sql  # 57 verified records
├── .env.example                      # Template — copy to .env
├── package.json                      # Frontend deps
├── FEATURES-ADDON.md                 # v1.1.0 — Camera, QR, OCR, Push
├── UI-REDESIGN-v1.2.0.md             # v1.2.0 — Premium chat UI redesign
├── README.md                         # Full project docs
└── QUICKSTART.md                     # THIS FILE
```

---

## Option A — Run Frontend Only (Fastest, 2 min)

If you just want to SEE the redesigned UI without setting up Supabase or the backend, the app runs in **demo mode** with mock data.

### Prerequisites
- Node.js 18+ (check: `node --version`)
- npm 9+ (check: `npm --version`)

### Steps

```bash
# 1. Unzip
unzip Dayjoy-AI-Assist-v2.0.0-Complete.zip
cd dayjoy-ai-assist

# 2. Install frontend deps
npm install

# 3. Start dev server
npm run dev
```

Open **http://localhost:5173** in your browser.

**What works in demo mode:**
- ✅ Redesigned chat UI (welcome screen, message bubbles, composer, streaming shimmer)
- ✅ Product Discovery (with mock products)
- ✅ Camera capture, QR scanner, OCR scanner
- ✅ Push notification settings UI (permission flow)
- ✅ Admin console (with mock data)
- ✅ All animations, theme toggle, language switcher

**What WON'T work in demo mode:**
- ❌ Actual AI responses (needs backend + Groq API key)
- ❌ Login (any email/password works, but no real auth)
- ❌ Persistent chat history (in-memory only)
- ❌ Real-time notifications (needs Supabase)

---

## Option B — Full Stack with Real AI (10 min)

### Prerequisites
- Node.js 18+
- Python 3.11+
- A free [Supabase](https://supabase.com) project
- A free [Groq](https://console.groq.com) API key (or OpenAI key as fallback)

### Step 1 — Set Up Supabase

1. Go to **https://supabase.com** → sign in → **New Project**
2. Name it `dayjoy-ai-assist`, pick a region close to you
3. Wait ~2 min for project to provision
4. Go to **Settings → API** and copy:
   - `Project URL` (looks like `https://abcdefgh.supabase.co`)
   - `anon public` key (long string)
5. Go to **SQL Editor** → **New Query**
6. Paste the contents of **`supabase_schema_complete.sql`** → Run
   - This creates all 29 tables, 71 RLS policies, 31 indexes, 19 triggers, 1 view, 2 storage buckets, and 4 integration seeds in ONE shot
7. Paste the contents of **`supabase_knowledge_base_seed.sql`** → Run
   - This loads 57 verified knowledge records (products, FAQs, policies, training, objections, social templates)

### Step 2 — Configure Frontend

```bash
# From the project root:
cp .env.example .env
```

Open `.env` in your editor and fill in:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
VITE_API_BASE_URL=http://127.0.0.1:8000
```

### Step 3 — Set Up Backend

```bash
cd backend

# Create virtual env
python -m venv venv
source venv/bin/activate    # on Windows: venv\Scripts\activate

# Install Python deps
pip install -r requirements.txt

# Create backend .env
cat > .env << 'EOF'
GROQ_API_KEY=your-groq-key-here
OPENAI_API_KEY=your-openai-key-here
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
JWT_SECRET=any-random-32-char-string
EOF

# Start the backend
uvicorn main:app --reload --port 8000
```

Get your Groq API key from **https://console.groq.com/keys** (free tier: 30 req/min).

### Step 4 — Start Frontend

Open a NEW terminal (keep backend running):

```bash
cd dayjoy-ai-assist    # project root, not backend/
npm install
npm run dev
```

Open **http://localhost:5173**.

### Step 5 — Create Your First Admin User

In Supabase → **Authentication → Users** → **Add user**:
- Email: `admin@dayjoy.com`
- Password: anything (e.g. `Admin123!`)
- Auto Confirm User: ✅

Then in **SQL Editor**:
```sql
-- Promote user to admin role
UPDATE profiles
SET role = 'admin'
WHERE email = 'admin@dayjoy.com';
```

Login at **http://localhost:5173/login** with those credentials.

---

## What to Test (Verification Checklist)

Once the app is running, walk through this checklist to confirm everything works:

### Frontend UI (Option A or B)
- [ ] **Welcome screen** — open `/` → see personalized greeting + 4 prompt cards + trust badges
- [ ] **Click a prompt card** — sends a message (in demo mode: shows error since no backend; in full mode: AI responds)
- [ ] **Theme toggle** — top right, switches light/dark smoothly
- [ ] **Language switcher** — switch to हिन्दी, UI updates
- [ ] **Sidebar** — click "New conversation" button, see brand header at top
- [ ] **Composer** — focus the textarea, see glow halo + `<kbd>` hints appear
- [ ] **Tools menu** — click paperclip icon → dropdown with Camera / QR / OCR
- [ ] **Camera** — click "Take photo" → grant permission → capture a photo → see thumbnail in composer
- [ ] **QR Scanner** — click "Scan QR code" → point at any QR → see decoded text
- [ ] **OCR** — click "Extract text (OCR)" → drop an image with English text → see extracted text
- [ ] **Product Discovery** — go to `/products` → see "Scan QR" / "Photo" / "OCR" buttons next to search

### Settings (Push Notifications)
- [ ] Go to `/settings` → scroll to **Push Notifications** card
- [ ] Click **"Enable push"** → browser shows permission prompt → Allow
- [ ] Click **"Send test"** → see OS-level notification appear
- [ ] Click the notification → app focuses + navigates

### Admin Console (Option B only — needs real data)
- [ ] Login as admin → click "Admin Console" in sidebar
- [ ] **Dashboard** — see stats cards + recent activity
- [ ] **Knowledge Manager** — see 57 seeded records, search works
- [ ] **Products** — see seeded products, CRUD works
- [ ] **AI Safety Rules** — see safety rules, toggle works
- [ ] **Integrations** — see all integrations marked Connected (green)
- [ ] **User Management** — see your admin user
- [ ] **Audit Logs** — see entries from your actions

### Backend (Option B only)
- [ ] Visit **http://localhost:8000/health** → see `{"status":"healthy"}`
- [ ] Visit **http://localhost:8000/docs** → see Swagger API docs
- [ ] Send a chat message in the UI → see streaming response (SSE)
- [ ] Check backend terminal → see request logs

---

## Build for Production

```bash
# Frontend — outputs to dist/
npm run build

# Preview the production build
npm run preview
```

The `dist/` folder contains static files you can deploy to any static host (Vercel, Netlify, Cloudflare Pages, nginx, S3+CloudFront).

For Docker deployment, use the included `Dockerfile` and `docker-compose.yml`.

---

## Troubleshooting

### "Camera API not available"
- You're on http:// (not localhost). Camera requires https OR localhost. Use `npm run dev` (which is on localhost:5173) or deploy behind https.

### "Push notifications aren't supported"
- On iOS Safari: install the app to your Home Screen first (Share → Add to Home Screen). iOS only allows notifications from installed PWAs.
- On desktop Chrome/Edge/Firefox: should work out of the box.

### "OCR is slow / failed"
- First run downloads ~10MB of language data. Subsequent runs are fast.
- For Hindi text: select "हिन्दी (Hindi)" or "English + Hindi (mixed)" from the language dropdown.

### "Supabase connection failed"
- Check `.env` values — URL must start with `https://` and end with `.supabase.co`
- Make sure you ran all 4 schema SQL files in order

### "Backend won't start"
- Make sure you activated the venv: `source venv/bin/activate`
- Check `backend/.env` has all 6 required keys
- Groq API key must start with `gsk_`

### "I see demo data even after setting up Supabase"
- Stop the dev server, delete `.env`, re-create from `.env.example`, restart
- Hard refresh the browser (Ctrl+Shift+R / Cmd+Shift+R)

---

## Need Help?

- **Full feature list**: see `README.md`
- **Architecture deep-dive**: see `ARCHITECTURE.md`
- **v1.1.0 features** (Camera/QR/OCR/Push): see `FEATURES-ADDON.md`
- **v1.2.0 UI redesign**: see `UI-REDESIGN-v1.2.0.md`
- **Project structure**: see `PROJECT_STRUCTURE.md`

---

## Versions

| Version | Date | What's New |
|---------|------|------------|
| **v2.0.0** | Today | Complete project — v1.0.0 base + v1.1.0 features + v1.2.0 UI redesign |
| v1.2.0 | Today | Premium chat UI redesign (8 areas polished) |
| v1.1.0 | Today | Camera upload, QR scanner, OCR, push notifications |
| v1.0.0 | Earlier | Initial production release (43 tables, 22 admin pages, 3D orb, voice, i18n) |

**Build status:** TypeScript 0 errors · ESLint 0 errors · Build 7.43s · 24/24 runtime tests pass
