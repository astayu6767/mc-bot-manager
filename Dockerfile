# syntax=docker/dockerfile:1
# MC Bot Manager — simple fix: one nightly, real binary, no dummy tricks
# Uses nightly-2024-02-01 which is before FixedBitSet E0284 breaking change
# Plus fixedbitset 0.5.7 patch to ensure E0284 is fixed

FROM rustlang/rust:nightly-2024-02-01-bookworm AS azalea
WORKDIR /src
ENV CARGO_TERM_COLOR=always \
    CARGO_NET_GIT_FETCH_WITH_CLI=true \
    CARGO_BUILD_JOBS=2 \
    CARGO_INCREMENTAL=0

COPY azalea-bridge/rust-toolchain.toml azalea-bridge/Cargo.toml ./

# Prefetch deps
RUN mkdir src && echo "fn main() {}" > src/main.rs \
    && cargo build --release || true

COPY azalea-bridge/src ./src

# Real build - single attempt, no fallback to dummy
# If this fails, Docker build fails and you see the real error
RUN touch src/main.rs && \
    echo ">> Building Azalea with $(rustc --version)" && \
    cargo build --release && \
    cp target/release/azalea-bridge /azalea-bridge && \
    echo ">> SUCCESS - real binary built" && \
    ls -lh /azalea-bridge

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder
RUN npm run build

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
