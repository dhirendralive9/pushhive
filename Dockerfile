FROM node:20-alpine

WORKDIR /app

# Install curl for health checks
RUN apk add --no-cache curl

# Copy package files first for better Docker layer caching
COPY package.json package-lock.json* ./

# Install production dependencies
RUN npm install --production

# Copy application code
COPY . .

# Create non-root user for security
RUN addgroup -S pushhive && adduser -S pushhive -G pushhive
RUN chown -R pushhive:pushhive /app
USER pushhive

EXPOSE 3000

# Health check — Docker will restart if this fails
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
