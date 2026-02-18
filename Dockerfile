# Kap10 Web Server - Development Dockerfile
FROM node:22-bookworm-slim

# Install dependencies for native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
  openssl \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files first for better caching
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches

# Install all dependencies
RUN pnpm install

# Copy the rest of the application
COPY . .

# Generate Prisma client
RUN pnpm prisma generate

# Expose port
EXPOSE 3000

# Default command (can be overridden in docker-compose)
CMD ["pnpm", "dev"]
