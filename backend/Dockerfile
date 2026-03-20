FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package.json
COPY yarn.lock yarn.lock
COPY .yarnrc.yml .yarnrc.yml
COPY .yarn .yarn
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN corepack enable && yarn install

COPY backend backend
WORKDIR /app/backend

RUN yarn run build

FROM node:20-alpine AS runtime
WORKDIR /app

RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

COPY package.json package.json
COPY yarn.lock yarn.lock
COPY .yarnrc.yml .yarnrc.yml
COPY .yarn .yarn
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN corepack enable && yarn workspaces focus billforge-backend --production

COPY --from=builder /app/backend/dist /app/backend/dist
COPY backend/runtime-manifest.*.json /app/backend/
COPY config /app/config

USER appuser

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

CMD ["node", "backend/dist/server.js"]
