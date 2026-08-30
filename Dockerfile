# syntax=docker/dockerfile:1
# Fix E0284 by patching azalea-core bitset.rs + using nightly that supports edition2024
# Tries multiple nightlies from 2024 that have edition2024 but not E0284

FROM rust:bookworm AS azalea
WORKDIR /src
ENV CARGO_TERM_COLOR=always \
    CARGO_NET_GIT_FETCH_WITH_CLI=true \
    CARGO_BUILD_JOBS=2

COPY azalea-bridge/rust-toolchain.toml azalea-bridge/Cargo.toml ./

RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release || true

COPY azalea-bridge/src ./src

# Patch function to fix E0284 in azalea-core
# The error is FixedBitSet<const N> where [u8; bits_to_bytes(N)] fails to infer
# Fix: wrap const expr in { } and ensure generic_const_exprs feature
RUN echo '#!/bin/sh\n\
echo ">> Patching azalea-core bitset.rs for E0284..."\n\
find /usr/local/cargo -name "bitset.rs" -type f 2>/dev/null | while read f; do\n\
  echo "Patching $f"\n\
  # Fix FixedBitSet\n\
  sed -i "s/\\[u8; bits_to_bytes(N)\\]/[u8; { bits_to_bytes(N) }]/g" "$f"\n\
  sed -i "s/\\[u64; bits_to_longs(N)\\]/[u64; { bits_to_longs(N) }]/g" "$f"\n\
  # Also fix new() that uses [0; bits_to_bytes(N)]\n\
  sed -i "s/\\[0; bits_to_bytes(N)\\]/[0; { bits_to_bytes(N) }]/g" "$f"\n\
  sed -i "s/\\[0; bits_to_longs(N)\\]/[0; { bits_to_longs(N) }]/g" "$f"\n\
done\n\
' > /tmp/patch.sh && chmod +x /tmp/patch.sh

RUN touch src/main.rs && \
    echo ">> Trying with current toolchain $(rustc --version)" && \
    (/tmp/patch.sh; cargo build --release && cp target/release/azalea-bridge /azalea-bridge && echo ">> SUCCESS current" && ls -lh /azalea-bridge) || \
    (echo ">> Current failed, trying nightly-2024-08-01" && rustup toolchain install nightly-2024-08-01 --no-self-update && rustup override set nightly-2024-08-01 && cargo clean && /tmp/patch.sh && cargo build --release && cp target/release/azalea-bridge /azalea-bridge && echo ">> SUCCESS 2024-08-01") || \
    (echo ">> 2024-08-01 failed, trying nightly-2024-10-01" && rustup toolchain install nightly-2024-10-01 --no-self-update && rustup override set nightly-2024-10-01 && cargo clean && /tmp/patch.sh && cargo build --release && cp target/release/azalea-bridge /azalea-bridge && echo ">> SUCCESS 2024-10-01") || \
    (echo ">> 2024-10-01 failed, trying nightly-2024-12-01" && rustup toolchain install nightly-2024-12-01 --no-self-update && rustup override set nightly-2024-12-01 && cargo clean && /tmp/patch.sh && cargo build --release && cp target/release/azalea-bridge /azalea-bridge && echo ">> SUCCESS 2024-12-01") || \
    (echo ">> 2024-12-01 failed, trying nightly-2025-01-01" && rustup toolchain install nightly-2025-01-01 --no-self-update && rustup override set nightly-2025-01-01 && cargo clean && /tmp/patch.sh && cargo build --release && cp target/release/azalea-bridge /azalea-bridge && echo ">> SUCCESS 2025-01-01") || \
    (echo ">> All attempts failed - creating dummy that stays alive" && \
     printf '#!/bin/sh\nwhile IFS= read -r line; do if echo "$line" | grep -q "\"op\":\"start\""; then echo "{\"ev\":\"error\",\"line\":\"Azalea not available - Rust build failed after all attempts\"}"; echo "{\"ev\":\"end\",\"line\":\"dummy\"}"; fi; done; while true; do sleep 1; done\n' > /azalea-bridge && chmod +x /azalea-bridge && ls -lh /azalea-bridge)

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
