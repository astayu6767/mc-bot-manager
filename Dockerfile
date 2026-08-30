# syntax=docker/dockerfile:1
# MC Bot Manager — production image (Railway / any Docker host)
# Stage 1 compiles the Azalea (Rust) sidecar. First build is slow (~10–20 min).
# Fixed: tries multiple nightly versions to handle FixedBitSet E0284

FROM rustlang/rust:nightly-bookworm AS azalea
WORKDIR /src
ENV CARGO_TERM_COLOR=always \
    CARGO_NET_GIT_FETCH_WITH_CLI=true \
    CARGO_BUILD_JOBS=2 \
    CARGO_INCREMENTAL=0

# Copy Rust manifests first for caching
COPY azalea-bridge/rust-toolchain.toml azalea-bridge/Cargo.toml ./

# Prefetch crates with a stub so later source-only changes reuse the cache.
RUN mkdir src && echo "fn main() {}" > src/main.rs \
    && cargo build --release || echo "Prefetch failed, continuing..."

COPY azalea-bridge/src ./src

# Build the real binary - tries multiple strategies
# 1. Try with pinned toolchain (2024-08-01)
# 2. If fails, try even older nightly
# 3. If fails, try git main branch of azalea
# 4. If all fail, create dummy so Node deploy still works
RUN touch src/main.rs && \
    echo ">> Attempt 1: Building with pinned toolchain (nightly-2024-08-01)..." && \
    (cargo build --release && cp target/release/azalea-bridge /azalea-bridge && echo ">> Azalea build succeeded with 2024-08-01") || \
    (echo ">> Attempt 1 failed, trying nightly-2024-06-01..." && \
     rustup toolchain install nightly-2024-06-01 && rustup override set nightly-2024-06-01 && \
     cargo build --release && cp target/release/azalea-bridge /azalea-bridge && echo ">> Azalea build succeeded with 2024-06-01") || \
    (echo ">> Attempt 2 failed, trying nightly-2024-04-01..." && \
     rustup toolchain install nightly-2024-04-01 && rustup override set nightly-2024-04-01 && \
     cargo build --release && cp target/release/azalea-bridge /azalea-bridge && echo ">> Azalea build succeeded with 2024-04-01") || \
    (echo ">> Attempt 3 failed, trying azalea from git main with latest nightly..." && \
     rustup override set nightly && \
     printf '[package]\nname = \"azalea-bridge\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\nazalea = { git = \"https://github.com/azalea-rs/azalea\", branch = \"main\", default-features = true }\nazalea-auth = { git = \"https://github.com/azalea-rs/azalea\", branch = \"main\" }\neyre = \"0.6\"\nparking_lot = \"0.12\"\nreqwest = { version = \"0.13\", default-features = false, features = [\"json\"] }\nserde = { version = \"1\", features = [\"derive\"] }\nserde_json = \"1\"\ntokio = { version = \"1\", features = [\"full\"] }\ntracing = \"0.1\"\ntracing-subscriber = { version = \"0.3\", features = [\"env-filter\"] }\nuuid = { version = \"1\", features = [\"serde\"] }\n\n[profile.release]\nlto = false\ncodegen-units = 8\nopt-level = 3\ndebug = false\nstrip = true\n' > Cargo.toml && \
     cargo build --release && cp target/release/azalea-bridge /azalea-bridge && echo ">> Azalea build succeeded with git main") || \
    (echo ">> WARNING: All Azalea Rust builds failed - creating dummy binary. JS engines (mineflayer/nmp) will still work." && \
     echo '#!/bin/sh' > /azalea-bridge && \
     echo 'echo "{\"ev\":\"error\",\"line\":\"Azalea binary not available - Rust build failed after trying multiple toolchains. Use mineflayer or nmp engine.\"}"' >> /azalea-bridge && \
     chmod +x /azalea-bridge)

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- dependencies (dev deps included: drizzle-kit is needed at startup) ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Placeholder so module init during `next build` doesn't throw.
# The real DATABASE_URL is injected by the platform at runtime.
ENV DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder
RUN npm run build

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=azalea /azalea-bridge /usr/local/bin/azalea-bridge
COPY package.json package-lock.json next.config.ts tsconfig.json ./
COPY drizzle.config.ts ./
COPY src/db ./src/db
COPY start.sh ./start.sh
RUN chmod +x ./start.sh /usr/local/bin/azalea-bridge && \
    ls -lh /usr/local/bin/azalea-bridge || echo "No azalea binary"
EXPOSE 3000
CMD ["./start.sh"]
