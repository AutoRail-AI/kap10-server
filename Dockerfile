# unerr Web Server - Development Dockerfile
FROM node:22-bookworm-slim

# Install dependencies for native modules (build-essential + python3 needed for sharp native addon)
RUN apt-get update && apt-get install -y --no-install-recommends \
  openssl \
  ca-certificates \
  build-essential \
  python3 \
  && rm -rf /var/lib/apt/lists/*

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files first for better caching
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches

# Install all dependencies.
# pnpm.onlyBuiltDependencies in package.json ensures sharp's install script runs,
# compiling the native addon for the container's platform (linux-arm64 or linux-x64).
RUN pnpm install

# Copy the rest of the application
COPY . .

# Generate Prisma client
RUN pnpm prisma generate

# Expose port
EXPOSE 3000

# Default command (can be overridden in docker-compose)
CMD ["pnpm", "dev"]
