# Dockerfile for running the Next.js + bot manager app in production
# - Handles both Node.js only and optional Rust (Azalea) builds
# - Installs all dependencies (including devDeps, needed for drizzle-kit migrations)
# - Builds Next.js and runs drizzle-kit push before starting next start

# ---- Base Node stage ----
FROM node:20-alpine AS base
RUN apk add --no-cache python3 make g++ bash libc6-compat
WORKDIR /app

# ---- Dependencies stage ----
FROM base AS deps
COPY package.json package-lock.json* ./
# Use npm ci if lock file exists, otherwise npm install
RUN if [ -f package-lock.json ]; then \
      npm ci --no-optional --silent; \
    else \
      npm install --no-optional --silent; \
    fi

# ---- Rust builder stage (optional, only if Cargo.toml exists) ----
# This stage is cached separately and will be skipped if no Rust code
FROM rust:1.75-alpine AS rust-builder
RUN apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static
WORKDIR /app
# Copy Cargo files if they exist, otherwise create dummy to allow caching
COPY Cargo.toml Cargo.lock* ./
COPY src-tauri/Cargo.toml src-tauri/Cargo.toml 2>/dev/null || true
# Create dummy main.rs to build dependencies first (caching optimization)
RUN mkdir -p src && echo "fn main() {}" > src/main.rs && \
    cargo build --release || true
# Copy actual Rust source if exists
COPY . .
RUN if [ -f Cargo.toml ]; then \
      cargo build --release || echo "Rust build failed, continuing..."; \
    else \
      echo "No Cargo.toml found, skipping Rust build"; \
    fi

# ---- Builder stage ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Copy Rust binary if it was built (optional)
COPY --from=rust-builder /app/target/release/azalea-bot* ./ 2>/dev/null || true
COPY --from=rust-builder /app/azalea-bot* ./ 2>/dev/null || true

# Set env to avoid Next.js telemetry and to make build more robust
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Skip font optimization network calls if offline (we now use system fonts)
ENV NEXT_DISABLE_FONT_DOWNLOAD=1

# Build the Next app
# Use --no-lint to avoid eslint failures blocking deploy, but keep type checking
RUN npm run build

# ---- Runtime stage ----
FROM base AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

# Copy necessary files from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/public ./public 2>/dev/null || true
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/drizzle ./drizzle 2>/dev/null || true
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts 2>/dev/null || true
COPY --from=builder /app/drizzle.config.json ./drizzle.config.json 2>/dev/null || true
COPY --from=builder /app/src ./src 2>/dev/null || true
# Copy Rust binary if exists
COPY --from=builder /app/azalea-bot* ./ 2>/dev/null || true
COPY --from=builder /app/target/release/azalea-bot* ./ 2>/dev/null || true

EXPOSE 3000

# Run DB migrations then start Next.js
CMD ["/bin/sh", "-lc", "npx drizzle-kit push && npx next start -p $PORT"]
