#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
command -v node >/dev/null
command -v python3 >/dev/null
command -v cargo >/dev/null
command -v pnpm >/dev/null
mkdir -p .runtime
cp demo/live/runtime-package.json .runtime/package.json
npm install --prefix .runtime
pnpm install --frozen-lockfile
npm install --prefix apps/actors/bridge/terse
cargo build --locked --manifest-path apps/actors/Cargo.toml
pnpm --filter @sealed-verdict/web build
printf '\nReady. Put provider keys in .env, then run pnpm demo:live.\n'
