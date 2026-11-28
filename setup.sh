#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
command -v git >/dev/null || { echo "git is required"; exit 1; }
command -v npm >/dev/null || { echo "npm is required"; exit 1; }
echo "[1/3] Installing the Luau protection engine..."
if [ ! -f "Clyde/dist/cli/obfuscate.js" ]; then
  rm -rf Clyde
  git clone --depth 1 https://github.com/sfr-development/Lua-Obfuscator-Clyde-Protection.git Clyde
  (cd Clyde && npm install && npm run build)
fi
echo "[2/3] Installing StarVeil dependencies..."
npm install
echo "[3/3] Preparing data and temporary folders..."
mkdir -p data temp
echo
echo "StarVeil setup complete."
echo "Engine: Clyde Luau obfuscator."
echo "Set DISCORD_TOKEN, CLIENT_ID, GUILD_ID (optional), and ADMIN_IDS (optional)."
echo "Enable Message Content Intent for !credits and !addcredits."
