# Project Eternal — Discord Obfuscator

A Discord.js v14 bot that posts a public Project Eternal panel and runs a private Lua/Luau protection workflow.

The protection engine is a third-party dependency. Its original license and required notices are retained with the dependency; the Project Eternal interface and generated-file branding do not replace those notices.

## Requirements

- Linux hosting (Wispbyte Node.js hosting)
- Node.js 18.17+
- `git`, `curl`, and `tar` for setup
- Discord bot token and application ID

## Install

1. Copy `.env.example` to `.env` and fill in the values, or add the same variables in Wispbyte's environment-variable settings.
2. Run `bash setup.sh` once. It clones Prometheus, installs its bundled Linux Lua runtime, and runs `npm install`.
3. Run `npm run deploy` to register `/panel`.
4. Set Wispbyte's startup command to `npm start`.

Required environment variables:

```env
DISCORD_TOKEN=YOUR_BOT_TOKEN
CLIENT_ID=YOUR_DISCORD_APPLICATION_ID
GUILD_ID=YOUR_TEST_SERVER_ID
```

`GUILD_ID` is optional. Guild registration is quicker for testing; without it, `/panel` is registered globally.

## Use

1. Run `/panel` in the Discord server. The command posts the Project Eternal embed panel; its confirmation is ephemeral.
2. Click **OBFUSCATE** on the panel.
3. Choose **Eternal Engine**.
4. Configure the transformations, name generator, and Lua target.
5. Press **START!** and attach one `.lua`, `.luau`, or `.txt` file.
6. The result is returned ephemerally as `<original name> obf.lua`.

All interaction messages and result files after the panel button are ephemeral and visible only to the user who opened that session. The public panel itself is intentionally visible in the channel.

## Available protection settings

Transformation steps exposed in the UI:

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

Name generators: `MangledShuffled`, `Mangled`, `Confuse`, `Il`, `Number`.

Lua targets: `Lua51` and `LuaU` (the engine’s LuaU support is basic and not fully finished). Global variables are not renamed by a global-renaming toggle; the name generator controls identifiers Prometheus can rename, primarily local names.

The bot writes a per-job Lua config and invokes:

```bash
./bin/lua Prometheus/cli.lua --config ./temp/<job>.config.lua <input> --out <output>
```

The CLI is launched with `child_process.execFile`, with a 30-second timeout. Uploads are limited to 2 MiB. Temporary input, output, and config files are deleted after each run.

## Output header

The bot prepends this exact Lua comment to generated output:

```lua
-- The File Was Protected By Project Eternal https://discord.com/invite/XTsS4jhEbJ
```

## Notes

- The settings UI reflects documented Prometheus step names and options. Some combinations can be incompatible with a particular script or target runtime; users should test output before distribution.
- The engine's LuaU support is still basic/unfinished, so some Roblox Luau syntax may not be handled correctly.
- Output attachment limits are also subject to Discord's current upload limit for the bot/server.
- Do not commit `.env` or share the bot token.
