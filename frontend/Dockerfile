FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package.json
COPY yarn.lock yarn.lock
COPY .yarnrc.yml .yarnrc.yml
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN corepack enable && yarn install

COPY frontend frontend

WORKDIR /app/frontend
ARG VITE_API_BASE_URL=http://localhost:4100/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN yarn run build

FROM nginx:1.27-alpine AS runtime

RUN rm -rf /usr/share/nginx/html/*

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
