FROM node:20-alpine AS base
WORKDIR /app
COPY app/package*.json ./

FROM base AS development
RUN npm install
COPY app/ ./
EXPOSE 3000
CMD ["node", "server.js"]

FROM base AS deps
RUN npm ci --only=production

FROM node:20-alpine AS production
WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=deps /app/node_modules ./node_modules
COPY app/ ./
RUN chown -R appuser:appgroup /app
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', r => r.statusCode === 200 ? process.exit(0) : process.exit(1))"
CMD ["node", "server.js"]
