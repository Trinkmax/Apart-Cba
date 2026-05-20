# rentOS WhatsApp Gateway — Baileys persistent socket service.
# Multi-stage: build TS → slim runtime. Runs as non-root.
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Baileys instala `libsignal` desde git (+ binding nativo curve25519) →
# se necesita git y toolchain de compilación en el stage de build.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
# Reproducible si hay lockfile commiteado; si no, install (deploy directo del repo).
RUN if [ -f package-lock.json ]; then npm ci; else npm install --no-audit --no-fund; fi
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# tini for correct SIGTERM propagation (graceful socket shutdown on redeploy)
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
