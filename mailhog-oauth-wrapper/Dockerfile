FROM node:20-alpine

WORKDIR /app

COPY mailhog-oauth-wrapper/package.json /app/package.json
RUN npm install --no-audit --no-fund

COPY mailhog-oauth-wrapper/server.mjs /app/server.mjs

EXPOSE 8026

CMD ["npm", "run", "start"]
