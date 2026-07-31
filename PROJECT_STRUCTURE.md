# Dayjoy AI Assist — Project Structure

> **Both servers are running:**
> - Frontend: http://localhost:5173
> - Backend: http://localhost:8000
> - Health check: http://localhost:8000/health

---

## Quick Start

```bash
# Option 1: Use the start script
bash /home/z/my-project/scripts/start-dayjoy.sh

# Option 2: Manual start
# Terminal 1 — Backend
cd dayjoy-gpt-v5/backend
.venv/bin/uvicorn main:app --reload --port 8000

# Terminal 2 — Frontend
cd dayjoy-gpt-v5
npm run dev
```

---

## Directory Structure

```
dayjoy-gpt-v5/
│
├── index.html                      # Branded boot splash + favicon + PWA manifest link
├── package.json                    # dayjoy-ai-assist v1.0.0
├── tsconfig.json                   # Strict TypeScript
├── vite.config.ts                  # Vite + React + Tailwind + manual chunks
├── eslint.config.js                # ESLint flat config (TS + React Hooks)
├── Dockerfile                      # Multi-stage frontend build (Node → nginx)
├── docker-compose.yml              # Frontend + backend orchestration
├── nginx.conf                      # SPA fallback + gzip + cache + security headers
├── .env.example                    # Frontend env template
├── .dockerignore
│
├── public/
│   ├── manifest.json               # PWA manifest (name, icons, theme color)
│   └── sw.js                       # Service worker (offline caching)
│
├── supabase_schema.sql             # v1 — base 12 tables + read RLS
├── supabase_schema_v2.sql          # v2 — chat history, audit triggers, admin write RLS, storage
├── supabase_schema_v3.sql          # v3 — new roles (leader, trainer, support), notifications, realtime
├── supabase_schema_v4.sql          # v4 — AI memory, integration configs, push subscriptions
├── supabase_knowledge_base_seed.sql # 57 verified records from official Dayjoy sources
│
├── .github/workflows/ci.yml        # CI: typecheck + build + backend import check
│
├── src/
│   ├── main.tsx                    # Entry point — mounts <App/> + ErrorBoundary + SW register
│   ├── vite-env.d.ts               # Typed import.meta.env
│   │
│   ├── lib/                        # Shared frontend libraries
│   │   ├── api.ts                  # chatWithBackend + streamChatWithBackend + feedback
│   │   ├── supabaseClient.ts       # Re-export shim
│   │   ├── auth.ts                 # Re-export shim
│   │   └── db.ts                   # Re-export shim
│   │
│   └── app/
│       ├── App.tsx                 # Routes (lazy-loaded, role-guarded) + ThemeProvider + I18nProvider
│       │
│       ├── lib/                    # App-level libraries
│       │   ├── brand.ts            # Brand constants (name, colors, legacy names)
│       │   ├── auth.ts             # signUp/signIn + role resolution (profile-preferred)
│       │   ├── AuthContext.tsx     # useAuth() context
│       │   ├── ProtectedRoute.tsx  # Route guard
│       │   ├── PermissionDenied.tsx
│       │   ├── supabaseClient.ts   # Supabase client bootstrap
│       │   ├── db.ts               # CRUD for products/faqs/policies/training/leads/analytics
│       │   ├── chatStore.ts        # Chat conversation + message persistence
│       │   ├── useVoice.ts         # Web Speech API hook (STT + TTS)
│       │   ├── integrations.ts     # Typed integration interface (no hardcoded creds)
│       │   ├── demoData.ts         # Fallback data when Supabase is unconfigured
│       │   └── i18n/               # Internationalization
│       │       ├── I18nContext.tsx  # Provider + useI18n() hook
│       │       ├── types.ts         # TranslationKey + LanguageCode types
│       │       └── locales/
│       │           ├── en.ts        # English translations
│       │           └── hi.ts        # Hindi translations
│       │
│       ├── components/
│       │   ├── AppSelector.tsx     # Landing page — choose User App or Admin Console
│       │   │
│       │   ├── brand/
│       │   │   └── DayjoyLogo.tsx  # Official logo (full / mark / mono variants)
│       │   │
│       │   ├── three/
│       │   │   └── AIOrb.tsx       # 3D AI assistant (React Three Fiber — 7 states)
│       │   │
│       │   ├── common/             # Shared UI primitives
│       │   │   ├── AdminUI.tsx         # PageHeader, Card, StatCard, StatusPill, EmptyState, LoadingState, ErrorState
│       │   │   ├── AnimatedBackground.tsx # Mesh gradient + floating particles
│       │   │   ├── AppShellFallback.tsx   # Branded Suspense loader
│       │   │   ├── ErrorBoundary.tsx     # Global error boundary
│       │   │   ├── GlassCard.tsx         # Glassmorphism surface
│       │   │   ├── KnowledgeSearchViz.tsx # "Searching knowledge…" animation
│       │   │   ├── LanguageSwitcher.tsx  # i18n dropdown
│       │   │   ├── Modal.tsx             # Accessible dialog (portal + ESC + focus)
│       │   │   ├── Skeleton.tsx          # Shimmer placeholders
│       │   │   ├── ThemeProvider.tsx     # next-themes wrapper
│       │   │   ├── ThemeToggle.tsx       # Sun/moon animated toggle
│       │   │   └── TypewriterText.tsx    # Character-by-character text reveal
│       │   │
│       │   ├── charts/
│       │   │   └── SVGCharts.tsx   # BarChart, LineChart, DonutChart (no external dep)
│       │   │
│       │   ├── notifications/
│       │   │   └── NotificationCenter.tsx # Realtime bell + dropdown (Supabase Realtime)
│       │   │
│       │   ├── onboarding/
│       │   │   └── Onboarding.tsx  # First-time user walkthrough (7 steps)
│       │   │
│       │   ├── voice/
│       │   │   └── VoiceControls.tsx # Mic + speak + mute buttons + waveform
│       │   │
│       │   ├── user/               # 9 user-facing pages
│       │   │   ├── UserLayout.tsx          # Sidebar + mobile drawer + theme toggle
│       │   │   ├── UserChat.tsx            # Chat with streaming, history, voice, follow-ups
│       │   │   ├── ProductDiscovery.tsx    # Search + compare + recently viewed
│       │   │   ├── DistributorAssistant.tsx # 4 AI tools (objection, follow-up, social, plan)
│       │   │   ├── DistributorTraining.tsx # Modules + progress + certificates + leaderboard
│       │   │   ├── HumanSupport.tsx        # Ticket creation form
│       │   │   ├── UserSettings.tsx        # Language + notifications + AI memory
│       │   │   ├── LoginPage.tsx           # Branded login + signup
│       │   │   └── LeadCapturePage.tsx     # Public lead form
│       │   │
│       │   └── admin/              # 22 admin pages
│       │       ├── AdminLayout.tsx           # Glass sidebar + sectioned nav + theme toggle
│       │       ├── AdminDashboard.tsx        # Real Supabase counts + pending alerts
│       │       ├── AdminAnalytics.tsx        # SVG charts + CSV export
│       │       ├── AdminSettings.tsx         # Feature flags + env diagnostics
│       │       ├── AISafetyRules.tsx         # Safety rules toggle
│       │       ├── ApprovalQueue.tsx         # Cross-table pending items
│       │       ├── AuditLogs.tsx             # Filterable audit log + CSV export
│       │       ├── EmployeeDashboard.tsx     # Assigned tickets + chats
│       │       ├── LeaderDashboard.tsx       # Team size + training progress
│       │       ├── TrainerDashboard.tsx      # Module stats + recent modules
│       │       ├── SupportDashboard.tsx      # Ticket triage stats
│       │       ├── ManagementDashboard.tsx   # Executive overview
│       │       ├── FAQManager.tsx            # FAQ CRUD
│       │       ├── Integrations.tsx          # Connection status checker
│       │       ├── KnowledgeManager.tsx      # Upload + preview + approve
│       │       ├── KnowledgeTimeline.tsx     # Chronological audit feed
│       │       ├── LeadsCRM.tsx              # Lead triage + status update
│       │       ├── PolicyManager.tsx         # Policy CRUD
│       │       ├── ProductDatabase.tsx       # Product CRUD
│       │       ├── SupportTickets.tsx        # Ticket triage + comments thread
│       │       ├── TrainingManager.tsx       # Training CRUD
│       │       └── UserManagement.tsx        # Role change + search + filter
│       │
│       └── figma/
│           └── ImageWithFallback.tsx # Image with error fallback
│
├── styles/
│   ├── index.css                  # Imports fonts + tailwind + theme
│   ├── theme.css                  # Design tokens (light + dark) + glass + motion + keyframes
│   ├── tailwind.css               # Tailwind v4 config
│   ├── globals.css                # (empty — reserved)
│   └── fonts.css                  # (empty — reserved)
│
├── backend/
│   ├── main.py                    # FastAPI — JWT auth, SSE streaming, RAG, safety rules, rate limit
│   ├── requirements.txt           # Pinned Python deps
│   ├── Dockerfile                 # Python 3.11 slim
│   ├── .env.example               # Backend env template
│   └── README.md
│
├── data/                          # CSV seed data (historical reference)
│   ├── analytics.csv
│   ├── company_profile.csv
│   ├── distributor_training.csv
│   ├── faqs.csv
│   ├── objection_handling.csv
│   ├── policies.csv
│   ├── products.csv
│   └── social_content_templates.csv
│
├── guidelines/
│   └── Guidelines.md              # Original Figma Make guidelines
│
├── src/imports/                   # Figma design references (historical)
│   ├── *.png                      # 8 Figma screenshots
│   └── pasted_text/               # Figma design notes
│
├── README.md                      # Project documentation
├── ARCHITECTURE.md                # Architecture overview
├── NEXT_STEPS.md                  # Development roadmap
└── ATTRIBUTIONS.md                # Third-party attributions
```

---

## Key Commands

```bash
# Development
npm run dev              # Start Vite dev server (port 5173)
npm run build            # TypeScript check + Vite build
npm run build:fast       # Vite build (skip typecheck)
npm run typecheck        # TypeScript check only
npm run lint             # ESLint check
npm run lint:fix         # ESLint auto-fix
npm run preview          # Preview production build
npm run clean            # Remove dist + .vite cache

# Backend
cd backend
.venv/bin/uvicorn main:app --reload --port 8000    # Dev server
.venv/bin/python -c "import main"                   # Import check

# Docker
docker compose up --build    # Full-stack

# Testing
bash /home/z/my-project/scripts/test-final.sh       # 24-test runtime suite
bash /home/z/my-project/scripts/start-dayjoy.sh     # Start both servers

# Database (run in Supabase SQL Editor, in order)
# 1. supabase_schema.sql
# 2. supabase_schema_v2.sql
# 3. supabase_schema_v3.sql
# 4. supabase_schema_v4.sql
# 5. supabase_knowledge_base_seed.sql
```

---

## Environment Variables

### Frontend (`.env`)
```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
VITE_API_BASE_URL=http://127.0.0.1:8000
```

### Backend (`backend/.env`)
```env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<your-anon-key>
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
GROQ_API_KEY=<your-groq-key>           # Primary LLM
GROQ_MODEL=llama-3.3-70b-versatile
OPENAI_API_KEY=<your-openai-key>       # Fallback LLM
OPENAI_MODEL=gpt-4o-mini
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite 6 + TypeScript 5 + Tailwind CSS 4 |
| 3D | Three.js + @react-three/fiber + @react-three/drei |
| Animation | Framer Motion 11 |
| Icons | Lucide React |
| Markdown | react-markdown + remark-gfm |
| Theme | next-themes (dark mode) |
| i18n | Custom (en + hi) |
| Backend | FastAPI + Python 3.11 |
| AI | Groq (primary) + OpenAI (fallback) |
| Database | Supabase (Postgres + Auth + Storage + Realtime) |
| Auth | Supabase Auth (JWT) |
| PWA | manifest.json + service worker |
| Deploy | Docker + nginx |

---

## Production Readiness: 82/100

See `/home/z/my-project/download/FINAL_ENTERPRISE_REPORT.md` for the full scorecard.
