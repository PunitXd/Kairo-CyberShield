# syntax=docker/dockerfile:1
# Kairo Defender (ARCH D6: one process for the engine, console API, realtime
# and the dashboard on 7070). Build context is the repo root (npm workspaces).
#
#   dashboard stage  builds frontend/ with Vite
#   runtime stage    Defender + the built dashboard in backend/defender/public
#
# Only the built static files reach the runtime image: no Vite, no frontend
# node_modules, no source maps.

# ---- Stage 1: build the dashboard ----
FROM node:22-alpine AS dashboard
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/schema/package.json backend/schema/
COPY backend/hooks/package.json backend/hooks/
COPY backend/defender/package.json backend/defender/
COPY attacks/package.json attacks/
COPY frontend/package.json frontend/
# Dev dependencies included: Vite is needed to build.
RUN npm ci --workspace=kairo-dashboard --include-workspace-root=false
COPY frontend frontend
RUN npm run build -w frontend

# ---- Stage 2: the Defender ----
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

# Workspace manifests first so the dependency layer caches until they change.
COPY package.json package-lock.json ./
COPY backend/schema/package.json backend/schema/
COPY backend/hooks/package.json backend/hooks/
COPY backend/defender/package.json backend/defender/
COPY attacks/package.json attacks/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev --workspace=kairo-defender --include-workspace-root=false && npm cache clean --force

COPY backend/schema/src backend/schema/src
COPY backend/defender/src backend/defender/src
# KAIRO_RULES_PATH=/app/config/rules.json (ARCH §11.3)
COPY backend/defender/config /app/config
COPY --from=dashboard /app/frontend/dist backend/defender/public

USER node
EXPOSE 7070
CMD ["node", "backend/defender/src/index.js"]
