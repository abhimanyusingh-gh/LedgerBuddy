FROM node:20-alpine
WORKDIR /app
COPY local-sts/package.json package.json
RUN npm install --omit=dev
COPY local-sts/server.mjs server.mjs
EXPOSE 8090
CMD ["npm", "run", "start"]
