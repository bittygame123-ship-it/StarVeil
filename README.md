# StarVeil — Discord Lua/Luau Obfuscator

StarVeil is a Discord.js v14 bot that provides a private Lua/Luau obfuscation workflow powered by the Prometheus engine.

**Engine attribution:** Based on Prometheus by Elias Oelschner, https://github.com/prometheus-lua/Prometheus. Prometheus is included as a pinned Git submodule and retains its license. This attribution is also shown in the bot panel.

## Requirements

- Linux hosting (Wispbyte Node.js hosting)
- Node.js 18.17 or newer
- `git`, `curl`, and `tar` for setup
- Discord bot token and application ID

## Install

1. Clone/download the StarVeil repository. If using Git, initialize the Prometheus submodule with `git submodule update --init --recursive`.
2. Copy `.env.example` to `.env` or set the same values in Wispbyte's environment variables.
3. Run `bash setup.sh` once.
4. Run `npm run deploy` to register `/panel`.
5. Set the Wispbyte startup command to `npm start` (equivalent to `node src/index.js`).

Required environment variables:

```env
DISCORD_TOKEN=YOUR_BOT_TOKEN
CLIENT_ID=YOUR_DISCORD_APPLICATION_ID
GUILD_ID=YOUR_TEST_SERVER_ID
ADMIN_IDS=123456789012345678,234567890123456789
```

`GUILD_ID` is optional. `ADMIN_IDS` is an optional comma-separated list of Discord user IDs that should have admin privileges even without the Discord Administrator permission. Server members with the Administrator permission are also admins.

**Discord portal setting:** Enable the privileged **Message Content Intent** for the bot. The bot uses this for `!credits` and `!addcredits`.

## Use

1. Run `/panel` in a server text channel.
2. Click **OBFUSCATE**. The following workflow is private to the user who opened it.
3. Choose **StarVeil 1.0** from the obfuscator dropdown.
4. Upload one `.lua`, `.luau`, or `.txt` file.
5. Configure transformations, name generator, and Lua target, then press **START OBFUSCATION**.
6. The result is returned privately. If the interaction expires during a long job, StarVeil attempts to deliver the result by DM.

## Daily usage and credits

- Regular users receive **5 successful obfuscations per UTC day**. The allowance resets at 00:00 UTC.
- Failed obfuscations do not consume a daily use or credit.
- After the 5 daily uses, each extra credit allows one successful obfuscation.
- Extra credits carry over and do not expire.
- Users can check their balance with `!credits`.
- Admins can check another user's balance with `!credits @user`.
- Admins can grant credits with `!addcredits @user amount`.
- Admins (Discord Administrator permission or IDs listed in `ADMIN_IDS`) have unlimited obfuscations.

Usage is stored in `data/quota.json` and survives bot restarts. Keep the Wispbyte data directory persistent; do not delete this file if you want to preserve balances.

## Available protection settings

Steps exposed in the UI:

- `EncryptStrings`
- `ConstantArray` (Strings Only, Shuffle Constants, Rotate Constants)
- `NumbersToExpressions`
- `AntiTamper`
- `Cff` (Control Flow Flattening)
- `Vmify` (register virtual machine)
- `WrapInFunction`
- `SplitStrings`
- `ProxifyLocals`
- `AddVararg`

The three advanced transforms `SplitStrings`, `ProxifyLocals`, and `AddVararg` remain independently configurable. When all three are enabled, the settings panel warns that the ultra combination can take a few minutes.

Name generators: `MangledShuffled`, `Mangled`, `Confuse`, `Il`, `Number`.

Targets: `Lua51` and `LuaU`. Prometheus describes its LuaU support as basic and unfinished; some Roblox Luau syntax may not be supported. Test generated output before distributing it.

## Limits and runtime

- Input upload limit remains **2 MB**.
- Accepted extensions: `.lua`, `.luau`, `.txt`.
- Obfuscation subprocess has no fixed 30-second timeout. Large or ultra configurations are allowed to finish, subject to host resources and Discord delivery limits.
- The bot uses `execFile` with an argument array (not a shell command). Temporary input, output, and config files are removed after each job.

## Output header

Every generated file is prefixed with this exact line:

```lua
-- This File Was Protected By StarVeil https://discord.gg/2qzCyb5KUv
```

## Security notes

- Never commit `.env`, bot tokens, or `data/quota.json`.
- Enable Message Content Intent in the Discord Developer Portal.
- Obfuscation makes code harder to inspect but cannot guarantee that code is impossible to reverse engineer.

## License

StarVeil's bot code is separate from the Prometheus dependency. Prometheus retains its own license and attribution requirements; see `Prometheus/LICENSE` and the official project at https://github.com/prometheus-lua/Prometheus.
