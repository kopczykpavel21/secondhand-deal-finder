# ─── Build stage ──────────────────────────────────────────────────────────────
# Plain Node image — no Playwright browser download needed here
FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY . .

# Skip browser download — the runtime image already has browsers pre-installed
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run build --workspace=apps/web

# ─── Runtime stage ────────────────────────────────────────────────────────────
# Official Playwright image — Chromium + all 100+ system deps pre-installed
# No need to download browsers or install deps manually
FROM mcr.microsoft.com/playwright:v1.59.1-jammy AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy standalone Next.js output from builder
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
RUN mkdir -p ./apps/web/public

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
