#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

command -v git >/dev/null || { echo "git is required"; exit 1; }
command -v curl >/dev/null || { echo "curl is required"; exit 1; }
command -v tar >/dev/null || { echo "tar is required"; exit 1; }

echo "[1/3] Getting Prometheus source..."
if [ -d "Prometheus/.git" ]; then
  git -C Prometheus pull --ff-only
elif [ -e "Prometheus" ]; then
  echo "Prometheus exists but is not a Git checkout. Move/remove it and run setup again."
  exit 1
else
  git clone --depth 1 https://github.com/prometheus-lua/Prometheus.git Prometheus
fi

echo "[2/3] Downloading the official standalone Linux release..."
mkdir -p bin
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl -fsSL https://api.github.com/repos/prometheus-lua/Prometheus/releases/latest -o "$TMP_DIR/latest.json"
TAG="$(grep '"tag_name":' "$TMP_DIR/latest.json" | sed -E 's/.*"([^"]+)".*/\1/' | head -n1)"
if [ -z "$TAG" ]; then
  echo "Could not determine the latest Prometheus release."
  exit 1
fi

ARCHIVE="prometheus-lua-${TAG}-linux.tar.gz"
URL="https://github.com/prometheus-lua/Prometheus/releases/download/${TAG}/${ARCHIVE}"
curl -fL "$URL" -o "$TMP_DIR/$ARCHIVE"
tar -tzf "$TMP_DIR/$ARCHIVE" >/dev/null
mkdir -p "$TMP_DIR/extracted"
tar -xzf "$TMP_DIR/$ARCHIVE" -C "$TMP_DIR/extracted"

LUA_PATH="$(find "$TMP_DIR/extracted" -type f -path '*/runtime/lua' -print -quit)"
if [ -z "$LUA_PATH" ]; then
  echo "The official archive did not contain runtime/lua. Archive layout may have changed."
  find "$TMP_DIR/extracted" -maxdepth 4 -type f -print
  exit 1
fi
install -m 755 "$LUA_PATH" bin/lua
chmod +x bin/lua

echo "[3/3] Installing Node dependencies..."
npm install

echo
echo "Setup complete."
echo "Lua runtime: $ROOT_DIR/bin/lua"
echo "Prometheus source: $ROOT_DIR/Prometheus"
echo "Next: copy .env.example to .env, fill in DISCORD_TOKEN, CLIENT_ID and GUILD_ID."
