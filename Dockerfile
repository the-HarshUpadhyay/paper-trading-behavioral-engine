FROM node:20-alpine

WORKDIR /app

# Copy package files first for Docker layer caching
COPY package.json package-lock.json* ./

# Install production dependencies only
RUN npm ci --production 2>/dev/null || npm install --production

# Copy application code
COPY . .

# Expose API port
EXPOSE 3000

# Default command: migrate → seed → start server
CMD ["sh", "-c", "node src/migrate.js && node src/seed.js && node src/server.js"]
