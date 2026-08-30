# syntax=docker/dockerfile:1
# MC Bot Manager — production image (Railway / any Docker host)
# Stage 1 compiles the Azalea (Rust) sidecar. First build is slow (~10–20 min).
# 1:1 copy from Lexxxy123/arena/01a04ee5 plus minimal fix for EPIPE crash

FROM rustlang/rust:nightly-bookworm AS azalea
WORKDIR /src
ENV CARGO_TERM_COLOR=always \
    CARGO_NET_GIT_FETCH_WITH_CLI=true \
    CARGO_BUILD_JOBS=2
COPY azalea-bridge/rust-toolchain.toml azalea-bridge/Cargo.toml ./
# Prefetch crates with a stub so later source-only changes reuse the cache.
RUN mkdir src && echo "fn main() {}" > src/main.rs \
    && cargo build --release || true
COPY azalea-bridge/src ./src
# Try to build Rust, but create a long-lived dummy if it fails so Node can still deploy
# Dummy reads stdin and responds with error JSON for each start request (avoids EPIPE)
RUN touch src/main.rs && \
    (cargo build --release && cp target/release/azalea-bridge /azalea-bridge && echo ">> Rust build SUCCESS - real binary") || \
    (echo ">> Rust build FAILED - creating long-lived dummy that handles stdin" && \
     printf '#!/bin/sh\n# Dummy Azalea bridge - stays alive, reads stdin, replies with error\n# This prevents EPIPE crash when Node writes to it\nwhile IFS= read -r line; do\n  if echo "$line" | grep -q "\"op\":\"start\""; then\n    echo "{\"ev\":\"error\",\"line\":\"Azalea not available - Rust build failed. Use mineflayer or nmp engine.\"}"\n    echo "{\"ev\":\"end\",\"line\":\"dummy exit\"}"\n  fi\ndone\n# Keep alive if no input yet (for health checks)\nwhile true; do sleep 1; done\n' > /azalea-bridge && chmod +x /azalea-bridge && ls -lh /azalea-bridge)

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
RUN chmod +x ./start.sh /usr/local/bin/azalea-bridge && ls -lh /usr/local/bin/azalea-bridge
EXPOSE 3000
CMD ["./start.sh"]
