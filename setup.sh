#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

command -v git >/dev/null || { echo "git is required"; exit 1; }
command -v curl >/dev/null || { echo "curl is required"; exit 1; }
command -v tar >/dev/null || { echo "tar is required"; exit 1; }

echo "[1/3] Getting the pinned Prometheus source..."
if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 && [ -f .gitmodules ]; then
  git submodule update --init --recursive
fi
if [ ! -f "Prometheus/cli.lua" ]; then
  rm -rf Prometheus
  git clone https://github.com/prometheus-lua/Prometheus.git Prometheus
  git -C Prometheus checkout a98c50165f2a53f6d765a82eee60dfea53803445
fi

echo "[2/3] Installing the official standalone Lua runtime..."
mkdir -p bin
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
curl -fsSL https://api.github.com/repos/prometheus-lua/Prometheus/releases/latest -o "$TMP_DIR/latest.json"
TAG="$(grep '"tag_name":' "$TMP_DIR/latest.json" | sed -E 's/.*"([^"]+)".*/\1/' | head -n1)"
if [ -z "$TAG" ]; then echo "Could not determine the latest Prometheus release."; exit 1; fi
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

echo "[3/3] Installing Node dependencies..."
npm install
mkdir -p data temp

echo
echo "StarVeil setup complete."
echo "Lua runtime: $ROOT_DIR/bin/lua"
echo "Prometheus source: $ROOT_DIR/Prometheus"
echo "Next: set DISCORD_TOKEN, CLIENT_ID, GUILD_ID (optional), and ADMIN_IDS (optional)."
echo "Enable the Message Content Intent in the Discord Developer Portal for !credits and !addcredits."
