#!/usr/bin/env bash
set -euo pipefail
cd /home/user/sealed-verdict
if ! command -v cc >/dev/null; then apt-get update -qq && apt-get install -y -qq build-essential; fi
(
  if ! command -v cargo >/dev/null; then
    curl --proto '=https' --tlsv1.2 -fsS https://sh.rustup.rs | sh -s -- -y --profile minimal
  fi
  export PATH="$HOME/.cargo/bin:$PATH"
  cargo build --locked --release --manifest-path apps/actors/Cargo.toml --bin clerk_daemon
  mkdir -p apps/actors/target/debug
  cp apps/actors/target/release/clerk_daemon apps/actors/target/debug/clerk_daemon
) &
rust_pid=$!
npm install -g pnpm@12.4.1
mkdir -p .runtime
cp demo/live/runtime-package.json .runtime/package.json
npm install --prefix .runtime &
runtime_pid=$!
pnpm install --frozen-lockfile
npm install --prefix apps/actors/bridge/terse
pnpm --filter @sealed-verdict/web build
wait "$rust_pid"
wait "$runtime_pid"
chmod 600 /home/user/sealed-verdict.env
HOST=0.0.0.0 nohup node --env-file=/home/user/sealed-verdict.env demo/live/start.mjs > /home/user/sealed-verdict.log 2>&1 < /dev/null &
