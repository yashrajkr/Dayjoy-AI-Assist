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
numeric/version order (`scripts/run_migrations.sh` — note its hardcoded list stops at
v18; anything after that, including all `wellness_*`/`ai_coach_*` migrations, must be
applied manually, e.g. via the Supabase MCP `apply_migration` tool or the dashboard SQL
editor, same as those files' own headers say).

**Backend tests**: on a machine with multiple Python versions installed, `python -m
pytest` can appear "broken" (`No module named pytest`, or a `pydantic-core` build
failure) purely because the default `python` on PATH resolves to a newer interpreter
than the one this repo's dependencies were installed against — not because the test
suite itself is broken. Confirm which interpreter has a working install
(`py -0` / `py --list` on Windows) and invoke pytest explicitly through it, e.g.:

```bash
py -3.13 -m pytest backend/tests -q
```

If no interpreter has a working install yet, `pip install -r backend/requirements.txt`
under a Python version with a prebuilt `pydantic-core` wheel available (check
https://pypi.org/project/pydantic-core/#files) — building it from source needs a Rust
toolchain, which this environment does not have.

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
- Customer mobile chat is chat-first ("Professional" mode, default) vs. the older
  feature-dense "Explorer" mode — toggle lives in `ChatExperienceContext.tsx` /
  Settings → Chat experience. Professional mode gates out the bottom tab bar and
  quick-prompt cards on mobile only; desktop is unaffected either way. When adding
  chat-screen UI, check `useChatExperience()` + `useIsMobile()` before assuming it
  should always render.
- Settings (`src/app/components/user/settings/`) is an index page (`UserSettings.tsx`,
  compact grouped rows) that drills into full-screen subpages via `SettingsDetailShell`.
  Add new settings there, not as inline cards on the index — see `SettingsRow`'s
  `trailing` prop for on/off `Switch` rows vs. `value`+chevron rows that navigate.
- `NavLink`'s function-form `className`/`children` props break silently when wrapped in
  Radix's `asChild` (e.g. `<TooltipTrigger asChild>{link}</TooltipTrigger>` for a
  collapsed sidebar with tooltips) — Slot clones props before NavLink gets to resolve
  the function, so the literal function source ends up as the className string. Compute
  `isActive` yourself (`useLocation()` + `matchPath`) and pass a plain string instead.
- The Dayjoy logo/orb mark is a flat PNG on solid black (no alpha) at `src/assets/dayjoy-logo.png`
  — `useTransparentLogo.ts` chroma-keys it to transparent at runtime via canvas (no
  image-processing package in this project). `public/favicon.png` is a pre-baked static
  copy of the same processed image for the browser-tab icon / PWA manifest, since those
  load before any app JS runs and can't use the runtime hook.
- **If chat answers ever come back as raw "Q: ... A: ..." blocks concatenated together**
  (looks like a dumped FAQ table instead of one written answer), that's the no-LLM-available
  degraded fallback in `stream_response()` (`backend/main.py`) being hit in production —
  meaning both `GROQ_API_KEY` and `OPENAI_API_KEY` failed or are unset in that deployment.
  Check server logs for `"Both Groq and OpenAI unavailable"` (logged at `_llm_logger.error`)
  before assuming it's a prompt/UI bug. `SYSTEM_PROMPT` already has an explicit instruction
  against pasting raw retrieved Q&A entries verbatim, as a second line of defense for when the
  LLM *is* reachable — retrieved knowledge-base source documents are themselves authored in a
  literal "Q: ... A: ..." shorthand (see `backend/tests/test_adversarial_wrong_context.py`),
  so that's expected in the raw context and must be synthesized away, not blocked upstream.
- Conversation titles start as a truncated first message (`deriveTitle` in `chatStore.ts`)
  and are upgraded to an AI-generated summary shortly after via `generateConversationTitle()`
  (`/chat/title`) — if titles are staying as the raw first message forever, that's the same
  LLM-unavailable condition above, not a bug in the retitle logic itself.
- Per-message action bar on assistant replies (`MessageBubble` in `UserChat.tsx`) has Copy,
  Helpful/Not helpful, Regenerate (last message only), Read aloud (`onSpeak`, gated on
  `voice.ttsSupported`), and Share (`onShare`, native share sheet → clipboard fallback). User
  messages have hover-revealed Edit (resends from that point, dropping the tail) and Copy.
  Add new per-message actions here, following the existing `ActionButton` pattern, rather than
  building a separate action surface.
- Two separate conversation-list surfaces exist and were both tuned for text contrast
  together — keep them in sync if you touch one: the drawer's recent-chats list grouped by
  date (`groupChatsByDate`/`NavGroup` in `UserLayout.tsx`) and the in-chat History panel's
  conversation nav (`aria-label="Conversations"` in `UserChat.tsx`).

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
