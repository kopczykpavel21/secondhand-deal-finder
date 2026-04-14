FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install system deps needed to run Playwright install-deps
RUN apt-get update && apt-get install -y \
    curl wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests first for better layer caching
COPY package.json package-lock.json* ./
COPY apps/web/package.json ./apps/web/
COPY packages/types/package.json ./packages/types/
COPY packages/scoring/package.json ./packages/scoring/
COPY packages/core/package.json ./packages/core/
COPY packages/source-adapters/package.json ./packages/source-adapters/

RUN npm ci --ignore-scripts

# Install Playwright system dependencies + Chromium browser
RUN npx playwright install-deps chromium
RUN npx playwright install chromium

# Copy source and build
COPY . .
RUN npm run build --workspace=apps/web

# ─── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy Playwright browser binaries location from builder
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright

# Install Playwright runtime system libs
RUN apt-get update && apt-get install -y \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Copy everything from builder (app + node_modules + browser cache)
COPY --from=builder /app ./
COPY --from=builder /root/.cache/ms-playwright /root/.cache/ms-playwright

EXPOSE 3000

CMD ["npm", "run", "start", "--workspace=apps/web"]
