# Dayjoy AI Assist

> Enterprise AI Assistant for the Dayjoy wellness, healthcare, agriculture, and direct-selling ecosystem.

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-0%20errors-blue)]()
[![Version](https://img.shields.io/badge/version-2.13.0-blue)]()

## Overview

Dayjoy AI Assist is a complete enterprise-grade AI platform built across 10 development phases. It provides an intelligent AI assistant powered by RAG (Retrieval-Augmented Generation), a full enterprise admin console, distributor business tools, customer experience platform, executive analytics, omnichannel communication, workflow automation, and enterprise security/governance/compliance.

## Key Features

### AI & RAG
- **Full RAG pipeline** — extract text from PDF/DOCX/PPTX/XLSX/CSV/MD/TXT, semantic chunking, embedding generation, vector search
- **12 specialized AI agents** — Product Expert, Support Agent, Sales Coach, Distributor Coach, Training Coach, Marketing Assistant, Content Creator, Knowledge Manager, Analytics Advisor, Executive Assistant, Compliance Checker, Workflow Planner
- **Multi-agent collaboration** — chain agents for complex queries (Support → Knowledge → Product → Compliance → Final Response)
- **Confidence scoring** — verified/partial/unverified with source citations
- **Human handoff** — automatic support ticket creation for low-confidence answers
- **AI governance** — hallucination detection, risk scores, human overrides, prompt versioning

### Enterprise Admin Console
- Executive dashboard with real-time KPIs and charts
- User management with RBAC (9 roles, 19 pages, 8 actions)
- Knowledge base management with approval workflow
- Product/FAQ/Policy/Training management
- AI configuration (model, temperature, system prompt, safety rules)
- Audit logs (42 event types)
- Universal search across all entities

### Distributor AI Copilot
- Personalized dashboard with goals, progress, AI suggestions
- Customer profiling with AI product recommendations
- Follow-up manager with CRM-style task tracking
- Content generator (10 types: WhatsApp, Email, Social, Festival, etc.)
- Team management with leaderboard and recognition
- Business analytics with health score
- AI sales coach with role-play simulation

### Customer Experience Platform
- Personalized customer dashboard
- Favorites and collections
- Wellness journey (goals, activities, reminders)
- Knowledge center with universal search
- Support ticket tracking with replies and ratings
- Profile preferences with privacy controls

### Executive Analytics & BI
- Executive dashboard with 20+ KPIs (auto-refresh)
- AI analytics (accuracy, confidence, latency, top questions)
- Product/Distributor/Customer/Knowledge/Support/Training analytics
- System health monitor
- Real-time alerts
- CSV export for all metrics

### Omnichannel Communication
- WhatsApp/Email/SMS/Push/In-App channel support (adapter pattern)
- Conversation management with AI auto-replies and human handoff
- Campaign manager with delivery tracking
- Message template library (11 categories)
- Automation engine (10 trigger types)
- Webhook management with retry queue
- Integration hub (10 connector types: CRM, ERP, Inventory, etc.)

### Workflow Automation
- Visual workflow builder (9 node types, 15 triggers)
- Task queue with priority and retry
- Approval engine (10 types)
- Business rules (IF/THEN/ELSE)
- Scheduled jobs (cron, recurring, delayed)
- Background worker with exponential backoff

### Enterprise Security & Compliance
- Zero Trust architecture (continuous verification, session tracking)
- RBAC + ABAC (attribute-based access control)
- MFA architecture (TOTP + backup codes)
- Device management (trusted devices, fingerprinting)
- Security event logging (22 event types)
- Incident management with timeline
- AI governance records
- GDPR compliance (data export/delete, consent management, retention policies)
- Vulnerability scan tracking
- Penetration test checklist (12 checks, 100% pass)

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 6, TypeScript, Tailwind CSS 4, Framer Motion 11, Three.js |
| Backend | FastAPI, Python 3.11, Pydantic, httpx |
| Database | Supabase (PostgreSQL), RLS, pgvector |
| AI/LLM | Groq (Llama 3.3 70B), OpenAI (fallback), Local embeddings |
| Infrastructure | Docker, GitHub Actions, nginx, Redis |
| Storage | Supabase Storage (private buckets with RLS) |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React + Vite)                    │
│  48 lazy-loaded routes · 82 components · 3D AI Orb · PWA    │
└──────────────────────────┬──────────────────────────────────┘
                           │ JWT (Supabase Auth)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                Backend (FastAPI · 232 routes)                 │
│  /chat · /rag · /admin · /distributor · /customer ·          │
│  /analytics · /comm · /workflow · /agent · /security         │
└──────┬──────────────┬──────────────┬────────────────────────┘
       │              │              │
       ▼              ▼              ▼
┌──────────┐  ┌──────────┐  ┌──────────────────┐
│ Supabase │  │  Groq    │  │  Background       │
│ PostgreSQL│  │  LLM API │  │  Worker           │
│ 160+ tables│ │  (Llama) │  │  (task queue)     │
│ RLS on all│  └──────────┘  └──────────────────┘
└──────────┘
```

## Quick Start

### Prerequisites
- Node.js 20+
- Python 3.11+
- Supabase project
- Groq API key

### 1. Clone and install
```bash
git clone <repo-url> dayjoy
cd dayjoy
npm install
cd backend && pip install -r requirements.txt && cd ..
```

### 2. Configure environment
```bash
# Frontend
cp .env.example .env
# Edit .env with your Supabase URL, anon key, and backend URL

# Backend
cp backend/.env.example backend/.env  # if exists, or create manually
# Edit with SUPABASE_URL, SUPABASE_ANON_KEY, GROQ_API_KEY, etc.
```

### 3. Apply database migrations
```bash
export DATABASE_URL="postgresql://user:pass@host:5432/db"
./scripts/run_migrations.sh
```

### 4. Run development servers
```bash
# Terminal 1: Backend
cd backend && uvicorn main:app --reload --port 8000

# Terminal 2: Frontend
npm run dev
```

### 5. Or use Docker
```bash
docker compose -f docker-compose.dev.yml up --build
```

## Production Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for complete deployment instructions (Docker, Render, Railway, VPS, AWS).

```bash
# Quick production start
docker compose -f docker-compose.prod.yml up -d --build
```

## API Documentation

- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`
- **Health check**: `http://localhost:8000/health`
- **Readiness check**: `http://localhost:8000/ready`

## Project Structure

See [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md) for detailed folder structure.

## Database Schema

14 SQL migration files:
- `supabase_schema.sql` — Base tables (12)
- `supabase_schema_v2.sql` through `supabase_schema_v13_security.sql` — Progressive migrations

All migrations are idempotent (safe to re-run).

## Security

- JWT authentication on every API request
- RLS on all 160+ database tables
- RBAC with 9 roles × 19 pages × 8 actions
- ABAC with attribute-based conditions
- Rate limiting (30 req/60s/user)
- Audit logging (42 event types)
- Security event logging (22 event types)
- Penetration test checklist (12 checks, 100% pass)

See [PRODUCTION_AUDIT.md](./PRODUCTION_AUDIT.md) for complete security review.

## Performance

- 48 lazy-loaded routes (code splitting)
- Multi-stage Docker builds
- Redis caching layer
- Indexed database queries (100+ indexes)
- Materialized views for dashboards
- SSE streaming for chat
- Background worker for async tasks

## License

Proprietary — Dayjoy. All rights reserved.
