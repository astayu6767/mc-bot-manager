# syntax=docker/dockerfile:1
# Fix E0284 by replacing bitset.rs with Vec-based version that doesn't use generic_const_exprs
# Uses git main which has edition2024 support

FROM rust:bookworm AS azalea
WORKDIR /src
ENV CARGO_TERM_COLOR=always \
    CARGO_NET_GIT_FETCH_WITH_CLI=true \
    CARGO_BUILD_JOBS=2

COPY azalea-bridge/rust-toolchain.toml azalea-bridge/Cargo.toml ./
COPY azalea-bridge/fixed_bitset.rs ./fixed_bitset.rs

RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release || true

COPY azalea-bridge/src ./src

# Patch script that replaces bitset.rs with our fixed version
RUN echo '#!/bin/sh\n\
echo ">> Patching azalea-core bitset.rs with fixed Vec version..."\n\
find /usr/local/cargo -name "bitset.rs" -type f 2>/dev/null | while read f; do\n\
  echo "Replacing $f with fixed version"\n\
  cp /src/fixed_bitset.rs "$f"\n\
done\n\
ls -lh /usr/local/cargo/git/checkouts/azalea-*/ -R 2>/dev/null | grep bitset || true\n\
' > /tmp/patch.sh && chmod +x /tmp/patch.sh

RUN touch src/main.rs && \
    echo ">> Building Azalea git main with $(rustc --version)" && \
    /tmp/patch.sh && \
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
