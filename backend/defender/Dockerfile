# syntax=docker/dockerfile:1
# Kairo Defender. Build context is the repo root (npm workspaces).
# Oct 20 task 5 turns this multi-stage, building the dashboard into public/.
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

USER node
EXPOSE 7070
CMD ["node", "backend/defender/src/index.js"]
