# ============================================================================
# Dayjoy AI Assist — Frontend Production Dockerfile (multi-stage build)
# ============================================================================
# Builds the Vite React app with Node, then serves the static dist/ with nginx.
# Final image is ~25 MB.

# ---------- Stage 1: build ----------
FROM node:20-alpine AS build
WORKDIR /app

# Install deps first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# Copy source
COPY . .

# Build args for Vite env vars (inject at build time)
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_API_BASE_URL
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

# Build
RUN npm run build:fast

# ---------- Stage 2: serve ----------
FROM nginx:1.27-alpine AS serve

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built static files
COPY --from=build /app/dist /usr/share/nginx/html

# Security headers
RUN echo 'server_tokens off;' >> /etc/nginx/nginx.conf

EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
