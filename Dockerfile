# syntax=docker/dockerfile:1
# Use git main branch of azalea - it supports edition2024 AND has E0284 fix
# Use latest nightly which supports edition2024

FROM rust:bookworm AS azalea
WORKDIR /src
ENV CARGO_TERM_COLOR=always \
    CARGO_NET_GIT_FETCH_WITH_CLI=true \
    CARGO_BUILD_JOBS=2

RUN rustc --version && cargo --version

COPY azalea-bridge/rust-toolchain.toml azalea-bridge/Cargo.toml ./

RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release || true

COPY azalea-bridge/src ./src

RUN touch src/main.rs && \
    echo ">> Building Azalea git main with $(rustc --version)" && \
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
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
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
