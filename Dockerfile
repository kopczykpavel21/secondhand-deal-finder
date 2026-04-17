# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY . .

# Skip browser download — Playwright is a dev dependency only (Sbazar/Facebook
# adapters). The live adapters (Bazoš, Vinted, Aukro) use plain fetch().
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run build --workspace=apps/web

# ─── Runtime stage ────────────────────────────────────────────────────────────
# Plain slim Node image — no Playwright/Chromium needed at runtime.
# Vinted, Bazoš and Aukro all use plain fetch(); Sbazar pre-checks and
# falls back to Playwright only if the CMP wall is not detected (rare).
FROM node:20-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy standalone Next.js output from builder
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
RUN mkdir -p ./apps/web/public

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
