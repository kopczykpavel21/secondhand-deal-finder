# ─── Build stage ──────────────────────────────────────────────────────────────
# Use the official Playwright image so Chromium + system libs are pre-installed.
FROM mcr.microsoft.com/playwright/node:20-jammy AS builder

WORKDIR /app

# Copy manifests first for better layer caching
COPY package.json package-lock.json* ./
COPY apps/web/package.json ./apps/web/
COPY packages/types/package.json ./packages/types/
COPY packages/scoring/package.json ./packages/scoring/
COPY packages/core/package.json ./packages/core/
COPY packages/source-adapters/package.json ./packages/source-adapters/

# Install all dependencies (including workspaces)
RUN npm ci --ignore-scripts

# Copy source
COPY . .

# Build Next.js app (tsc + webpack)
RUN npm run build --workspace=apps/web

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright/node:20-jammy AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy built app and node_modules from builder
COPY --from=builder /app ./

EXPOSE 3000

# Playwright needs this env to find the bundled browser
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

CMD ["npm", "run", "start", "--workspace=apps/web"]
