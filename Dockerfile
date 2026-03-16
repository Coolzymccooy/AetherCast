# ── Stage 1: Build frontend ──────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY . .
RUN npm run build

# ── Stage 2: Production runtime ─────────────────────────────────────────────
FROM node:22-alpine AS runtime

# Install FFmpeg (required for streaming)
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Copy package files and install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy built frontend
COPY --from=builder /app/dist ./dist

# Copy server source files
COPY server.ts ./
COPY src/lib/sanitize.ts ./src/lib/sanitize.ts

# Copy tsconfig for tsx runtime
COPY tsconfig.json ./

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/ || exit 1

# Environment
ENV NODE_ENV=production
ENV PORT=3001

# Start server
CMD ["npx", "tsx", "server.ts"]
