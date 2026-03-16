# ── Stage 1: Build frontend + prepare server ────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install ALL dependencies (devDeps needed for build + tsx)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build frontend
COPY . .
RUN npm run build

# ── Stage 2: Production runtime ─────────────────────────────────────────────
FROM node:22-alpine AS runtime

# Install FFmpeg (required for streaming)
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Copy ALL node_modules from builder (tsx + vite needed at runtime for server.ts)
COPY --from=builder /app/node_modules ./node_modules

# Copy package files
COPY package.json package-lock.json ./

# Copy built frontend
COPY --from=builder /app/dist ./dist

# Copy server and all source files it imports
COPY server.ts tsconfig.json vite.config.ts ./
COPY src/ ./src/

# Expose port
EXPOSE 3001

# Health check — increased start period for cold start
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/ || exit 1

# Environment
ENV NODE_ENV=production
ENV PORT=3001

# Start server using tsx (TypeScript execution)
CMD ["npx", "tsx", "server.ts"]
