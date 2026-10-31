FROM rust:1-bookworm AS protocol
WORKDIR /src
COPY packages/protocol packages/protocol
COPY apps/actors/Cargo.toml apps/actors/Cargo.lock apps/actors/
COPY apps/actors/src apps/actors/src
RUN cargo build --locked --release --manifest-path apps/actors/Cargo.toml --bin clerk_daemon

FROM node:22-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm@12.4.1
WORKDIR /app
COPY . .
RUN mkdir -p .runtime && cp demo/live/runtime-package.json .runtime/package.json \
    && npm install --prefix .runtime \
    && pnpm install --frozen-lockfile \
    && npm install --prefix apps/actors/bridge/terse \
    && pnpm --filter @sealed-verdict/web build
COPY --from=protocol /src/apps/actors/target/release/clerk_daemon /app/apps/actors/target/debug/clerk_daemon
ENV HOST=0.0.0.0 PORT=8090
EXPOSE 8090
CMD ["node", "demo/live/start.mjs"]
