# syntax=docker/dockerfile:1
# Placeholder until Oct 19 task 5 (Defender core) and Oct 20 task 5 (multi-stage
# build with the dashboard). Build context is the repo root.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY defender/package.json defender/package.json
COPY defender/src defender/src
USER node
EXPOSE 7070
CMD ["node", "defender/src/index.js"]
