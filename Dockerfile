# syntax=docker/dockerfile:1
FROM rustlang/rust:nightly-bookworm AS azalea
WORKDIR /src
ENV CARGO_TERM_COLOR=always CARGO_NET_GIT_FETCH_WITH_CLI=true CARGO_BUILD_JOBS=1 CARGO_INCREMENTAL=0 RUSTFLAGS="-C debuginfo=0"
COPY azalea-bridge/rust-toolchain.toml azalea-bridge/Cargo.toml ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release || echo "Prefetch failed"
COPY azalea-bridge/src ./src

# Build with many fallbacks - shows real errors
RUN touch src/main.rs && \
    echo "=== AZALEA BUILD START ===" && \
    echo "Toolchain: $(rustc --version)" && \
    echo "Trying pinned (nightly-2024-02-01) with azalea 0.16.0..." && \
    (cargo build --release 2>&1 && cp target/release/azalea-bridge /azalea-bridge && echo ">> SUCCESS PINNED" && ls -lh /azalea-bridge) || \
    (echo ">> PINNED FAILED, trying nightly-2024-08-01" && rustup toolchain install nightly-2024-08-01 --no-self-update && rustup override set nightly-2024-08-01 && cargo clean && cargo build --release 2>&1 && cp target/release/azalea-bridge /azalea-bridge && echo ">> SUCCESS 2024-08-01" && ls -lh /azalea-bridge) || \
    (echo ">> 2024-08-01 FAILED, trying 2024-06-01" && rustup toolchain install nightly-2024-06-01 --no-self-update && rustup override set nightly-2024-06-01 && cargo clean && cargo build --release 2>&1 && cp target/release/azalea-bridge /azalea-bridge && echo ">> SUCCESS 2024-06-01") || \
    (echo ">> 2024-06-01 FAILED, trying 2024-02-01" && rustup toolchain install nightly-2024-02-01 --no-self-update && rustup override set nightly-2024-02-01 && cargo clean && cargo build --release 2>&1 && cp target/release/azalea-bridge /azalea-bridge && echo ">> SUCCESS 2024-02-01") || \
    (echo ">> 2024-02-01 FAILED, trying 2023-12-01" && rustup toolchain install nightly-2023-12-01 --no-self-update && rustup override set nightly-2023-12-01 && cargo clean && cargo build --release 2>&1 && cp target/release/azalea-bridge /azalea-bridge && echo ">> SUCCESS 2023-12-01") || \
    (echo ">> ALL 0.16.0 FAILED, trying azalea git main (this should fix E0284)" && rustup override set nightly && \
     printf '[package]\nname = "azalea-bridge"\nversion = "0.1.0"\nedition = "2021"\n[dependencies]\nazalea = { git = "https://github.com/azalea-rs/azalea", branch = "main" }\nazalea-auth = { git = "https://github.com/azalea-rs/azalea", branch = "main" }\neyre = "0.6"\nparking_lot = "0.12"\nreqwest = { version = "0.13", default-features = false, features = ["json"] }\nserde = { version = "1", features = ["derive"] }\nserde_json = "1"\ntokio = { version = "1", features = ["full"] }\ntracing = "0.1"\ntracing-subscriber = { version = "0.3", features = ["env-filter"] }\nuuid = { version = "1", features = ["serde"] }\n[profile.release]\nlto = false\ncodegen-units = 8\nopt-level = 3\n' > Cargo.toml && \
     cargo clean && cargo build --release 2>&1 && cp target/release/azalea-bridge /azalea-bridge && echo ">> SUCCESS GIT MAIN" && ls -lh /azalea-bridge) || \
    (echo ">> GIT MAIN FAILED, trying with patched fixedbitset" && \
     printf '[package]\nname = "azalea-bridge"\nversion = "0.1.0"\nedition = "2021"\n[dependencies]\nazalea = { version = "0.16.0" }\nazalea-auth = "0.16.0"\neyre = "0.6"\nparking_lot = "0.12"\nreqwest = { version = "0.13", default-features = false, features = ["json"] }\nserde = { version = "1", features = ["derive"] }\nserde_json = "1"\ntokio = { version = "1", features = ["full"] }\ntracing = "0.1"\ntracing-subscriber = { version = "0.3", features = ["env-filter"] }\nuuid = { version = "1", features = ["serde"] }\n[patch.crates-io]\nfixedbitset = "0.5.7"\n[profile.release]\nlto = false\ncodegen-units = 8\nopt-level = 3\n' > Cargo.toml && rustup override set nightly-2024-02-01 && cargo clean && cargo build --release 2>&1 && cp target/release/azalea-bridge /azalea-bridge && echo ">> SUCCESS PATCHED") || \
    (echo ">> ALL FAILED, creating dummy (JS engines still work)" && echo '#!/bin/sh' > /azalea-bridge && echo 'echo "{\"ev\":\"error\",\"line\":\"Azalea not available - Rust build failed after all attempts\"}"' >> /azalea-bridge && chmod +x /azalea-bridge && ls -lh /azalea-bridge)

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
RUN chmod +x ./start.sh /usr/local/bin/azalea-bridge && ls -lh /usr/local/bin/azalea-bridge && file /usr/local/bin/azalea-bridge && /usr/local/bin/azalea-bridge --help 2>&1 | head -n 5 || echo "Binary check done (dummy will show error JSON)"
EXPOSE 3000
CMD ["./start.sh"]
