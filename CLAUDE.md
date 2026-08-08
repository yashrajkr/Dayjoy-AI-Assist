# Dayjoy AI Assist (v2.13.0) — CLAUDE.md

Guidance for Claude Code sessions working in this repo. Read this before making changes.

## What this is

An enterprise AI assistant platform for Dayjoy (direct-selling/MLM company), with:
- A customer/distributor-facing AI chat app with RAG-backed answers
- A large Admin Console (RBAC, knowledge base, product/pricing management, analytics,
  security/audit, communications, workflow automation)
- A FastAPI backend fronting Supabase (Postgres + Auth + Storage)

**The "AI Brain" advanced feature work is on hold** — do not start or implement it
unless explicitly asked.

## Stack

- Frontend: React 18 + TypeScript + Vite 6 + Tailwind CSS 4 + Framer Motion + Radix UI +
  React Router 7 + Three.js (chat orb, lazy-loaded)
- Backend: FastAPI (Python), modular routers: `main.py` (core chat + RAG), `admin_api.py`,
  `security_api.py`, `analytics_api.py`, `communication_api.py`, `workflow_api.py`,
  `distributor_api.py`, `customer_api.py`, `business_intelligence_api.py`
- DB/Auth: Supabase (Postgres, RLS, JWT/JWKS auth, Storage buckets)
- AI: Groq (primary LLM) with OpenAI fallback; swappable embedding providers for RAG

## Commands

```bash
npm install               # frontend deps
npm run dev                # vite dev server
npm run typecheck          # tsc --noEmit
npm run lint                # eslint .
npm run build                # typecheck + vite build
npm run test                  # vitest run
```

Backend: `pip install -r backend/requirements.txt`, run via uvicorn (`backend/main.py`
exposes `app`). SQL migrations live in `database/supabase_schema*.sql`, applied in
numeric/version order (`scripts/run_migrations.sh`).

## Authorization model — read this before touching any admin endpoint

- **Frontend route/UI gating is UX-only, never a security boundary.** `ProtectedRoute.tsx`,
  `AuthContext.tsx`, `RolePermissions.tsx` control what's *shown*, not what's *allowed*.
- **Every admin-sensitive backend route must call `_require_staff(request)`** (defined in
  `backend/main.py`, mirrored in the other `*_api.py` routers) before doing anything.
  Admin-only mutations (role changes, config changes, deletes) additionally check
  `_is_staff_admin(claims)`.
- Role comes from **verified JWT claims** (`claims["role"]` / `app_metadata.role`), resolved
  via Supabase JWKS signature verification in `verify_jwt()`. Never trust a client-supplied
  role header/param.
- When adding a new admin page that calls a new backend GET/POST/PUT/DELETE route, verify the
  route has `_require_staff` (or equivalent) applied — a page that's only gated in the
  frontend is a real vulnerability (see git history: three `/rag/documents*` read endpoints
  had this exact gap and were fixed).
- RLS is the last line of defense on the DB, but several endpoints use the Supabase
  **service-role key**, which bypasses RLS — so the app-level `_require_staff` check is often
  the *only* enforcement point, not a redundant one.

## Conventions

- Don't duplicate existing admin pages/components — inspect `src/app/components/admin/`
  first (34 components) before adding a new one.
- Admin components follow a consistent shape: loading skeleton → error state (with retry) →
  empty state → data view. Match this pattern in new pages (see `AdminUI.tsx` for shared
  primitives: `EmptyState`, `ErrorState`, etc.).
- No fabricated/demo production data. If demo data is needed for a feature under
  construction, label it clearly and keep it isolated from real Supabase-backed data.
- Mobile: sidebar/nav uses a drawer below `lg:` breakpoint (see `AdminLayout.tsx`) — keep
  new admin pages inside that shell rather than building bespoke navigation.
- Secrets (API keys, tokens) must never be returned in full from any endpoint — only
  prefixes/masked values (see `admin_list_api_keys` in `backend/admin_api.py`).
- `profiles.role` is guarded by a DB trigger (`database/supabase_schema_v18_profile_role_guard.sql`)
  that blocks a user from changing their own `role` via direct Supabase client writes; only
  requests made with the service-role key (`auth.role() = 'service_role'`, i.e. the trusted
  backend) or an existing admin can change it. If you add a new table with a privilege-bearing
  column writable via a "users can update own row" RLS policy, add the same kind of guard —
  don't assume RLS `USING (auth.uid() = id)` alone is safe for tables with a role/permission
  column.

## Where to look for existing docs

- `docs/PRODUCTION_AUDIT.md` — most recent full-project audit (architecture/security/perf
  scores as of v2.13.0). Treat as a snapshot, not current truth — verify claims before
  relying on them for new work.
- `docs/PRODUCTION_READINESS.md` — an earlier (pre-v2.13) readiness checklist; largely
  superseded by the audit above but still useful for deployment/env-var checklist items.
- `docs/ARCHITECTURE.md`, `docs/PROJECT_STRUCTURE.md`, `docs/DEPLOYMENT.md` — system design,
  folder layout, deployment instructions.

Do not re-run a full from-scratch repo audit for routine admin-console work — read the
existing docs above and inspect the specific feature area first.
