FROM node:20-alpine

WORKDIR /app

COPY infra/mailhog/package.json /app/package.json
RUN npm install --no-audit --no-fund

COPY infra/mailhog/server.mjs /app/server.mjs

EXPOSE 8026

CMD ["npm", "run", "start"]
