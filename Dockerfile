FROM node:20-alpine

WORKDIR /app

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

CMD ["node", "server.js"]
