# syntax=docker/dockerfile:1
# MC Bot Manager — production image (Railway / any Docker host)
# Stage 1 compiles the Azalea (Rust) sidecar. First build is slow (~10–20 min).

FROM rust:bookworm AS azalea
WORKDIR /src

ENV CARGO_TERM_COLOR=always \
    CARGO_NET_GIT_FETCH_WITH_CLI=true \
    CARGO_BUILD_JOBS=2 \
    RUSTUP_TOOLCHAIN=nightly-2026-07-02

RUN rustup toolchain install nightly-2026-07-02 --profile minimal

COPY azalea-bridge/rust-toolchain.toml azalea-bridge/Cargo.toml ./

RUN mkdir src && echo "fn main() {}" > src/main.rs \
    && cargo +nightly-2026-07-02 build --release || true

COPY azalea-bridge/src ./src

RUN touch src/main.rs \
    && cargo +nightly-2026-07-02 build --release \
    && cp target/release/azalea-bridge /azalea-bridge
    
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
RUN touch src/main.rs && cargo build --release \
    && cp target/release/azalea-bridge /azalea-bridge

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
RUN chmod +x ./start.sh /usr/local/bin/azalea-bridge
EXPOSE 3000
CMD ["./start.sh"]
