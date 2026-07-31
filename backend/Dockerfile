# ============================================================================
# Dayjoy AI Assist — Backend Production Dockerfile
# ============================================================================
# Multi-stage build: install deps, then copy source for a lean final image.

# ---------- Stage 1: builder ----------
FROM python:3.11-slim AS builder

WORKDIR /app

# System deps for building
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Python deps (separate layer for caching)
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# ---------- Stage 2: runtime ----------
FROM python:3.11-slim

WORKDIR /app

# Runtime system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy installed packages from builder
COPY --from=builder /root/.local /root/.local
ENV PATH=/root/.local/bin:$PATH

# Copy source
COPY . .

# Expose backend port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fs http://localhost:8000/health || exit 1

# Start uvicorn with configurable workers
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port 8000 --workers ${WORKERS:-4} --no-access-log"]
