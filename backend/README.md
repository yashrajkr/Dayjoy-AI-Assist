# Dayjoy AI Assist - AI Chat Backend (FastAPI)

This is a separate backend service for AI chat. It is intentionally kept independent from the React frontend.

## Endpoints

### `GET /`
Returns a simple running message.

### `GET /health`
Health check.

### `POST /chat`
Request:
```json
{
  "message": "string",
  "role": "customer",
  "language": "English"
}
```

Response:
```json
{
  "answer": "string",
  "category": "product/faq/policy/training/general/unsafe",
  "sources": [],
  "safety_status": "safe/blocked",
  "handoff_required": false
}
```

## Safety Rules (Important)

This backend enforces basic safety rules before it uses any data or calls OpenAI:

- No cure claims
- No diagnosis
- No treatment claims
- No guaranteed income
- No replacing doctor or medicine
- If the approved data does not match (unknown data), it triggers **human handoff**.

If a forbidden claim is detected, the API returns a **blocked** response.

## Supabase Knowledge Base

The `/chat` endpoint searches these Supabase tables (using only `approval_status = approved`):

- `products`
- `faqs`
- `policies`
- `distributor_training`
- `objection_handling`

It then builds a context from the matched rows and returns an answer.

If `OPENAI_API_KEY` is configured, it calls OpenAI using the approved context.
If no OpenAI key is present, it returns a rule-based answer from the matched data.

## Analytics Logging (Optional)

If Supabase is configured, it attempts to log requests/responses into:
- `SUPABASE_ANALYTICS_TABLE` (default: `analytics_chat_queries`)

Analytics failures never break chat.

## Environment Variables

Copy and edit:
- `backend/.env.example` -> `backend/.env`

Required:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

Optional:
- `OPENAI_API_KEY` (if missing, backend still works rule-based)

CORS:
- `ALLOWED_ORIGINS` (default: `http://localhost:5173`)

## Install & Run

### 1) Install Python dependencies
From the project root:
```bash
pip install -r backend/requirements.txt
```

### 2) Start the server
```bash
uvicorn backend.main:app --reload --port 8000
```

Backend URL:
- http://localhost:8000

## Test

### Health check
```bash
curl http://localhost:8000/health
```

Expected:
```json
{ "status": "ok" }
```

### Chat (rule-based if no OpenAI key)
```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "How do I handle customer objections about the product?",
    "role": "customer",
    "language": "English"
  }'
```

### Chat (blocked example)
```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "This can cure cancer guaranteed income with no risk.",
    "role": "customer",
    "language": "English"
  }'
