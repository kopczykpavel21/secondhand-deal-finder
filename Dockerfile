# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# System deps required by Playwright install-deps
RUN apt-get update && apt-get install -y \
    curl wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy the full repo first so npm workspace symlinks resolve correctly
COPY . .

# Install node deps — skip Playwright's postinstall browser download (we do it manually)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

# Install Playwright system libraries + Chromium browser binary
RUN npx playwright install-deps chromium
RUN npx playwright install chromium

# Ensure public dir exists
RUN mkdir -p apps/web/public

# Build Next.js (standalone output)
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run build --workspace=apps/web

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Playwright runtime system libraries + curl (cache-bust: v3)
RUN apt-get update && apt-get install -y \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libasound2 curl \
    && rm -rf /var/lib/apt/lists/*

# Copy standalone Next.js output
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
# public/ is empty — create it directly rather than copying from builder
RUN mkdir -p ./apps/web/public

# Copy Playwright browser binaries
COPY --from=builder /root/.cache/ms-playwright /root/.cache/ms-playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
