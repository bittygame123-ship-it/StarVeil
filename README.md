# StarVeil — Discord Luau Obfuscator

StarVeil is a Discord.js v14 bot with a private upload-and-obfuscate workflow. The dropdown provider is **StarVeil 1.0** and the panel is titled **StarVeil**. Its protection engine is the [Clyde Luau obfuscator](https://github.com/sfr-development/Lua-Obfuscator-Clyde-Protection).

## Requirements
- Linux hosting (including Wispbyte Node.js hosting)
- Node.js 18.17 or newer and npm
- Git
- Discord bot token and application ID

## Install
1. Clone or download this repository.
2. Set the environment variables below in Wispbyte (or copy `.env.example` to `.env`).
3. Run `bash setup.sh` once. This clones and builds the Luau engine and installs bot dependencies.
4. Run `npm run deploy` to register `/panel`.
5. Start the bot with `npm start`.

```env
DISCORD_TOKEN=YOUR_BOT_TOKEN
CLIENT_ID=YOUR_DISCORD_APPLICATION_ID
GUILD_ID=YOUR_TEST_SERVER_ID
ADMIN_IDS=123456789012345678,234567890123456789
```

`GUILD_ID` is optional. `ADMIN_IDS` is an optional comma-separated list of Discord user IDs that receive admin privileges without Discord Administrator permission. Server members with Administrator permission are also admins.

**Discord portal setting:** Enable the privileged **Message Content Intent** for `!credits` and `!addcredits`.

## Use
1. Run `/panel` in a server text channel.
2. Click **OBFUSCATE**. The workflow is private to the user who opened it.
3. Choose **StarVeil 1.0**.
4. Upload one `.lua`, `.luau`, or `.txt` file (maximum 2 MB).
5. Toggle protection settings and press **START OBFUSCATION**.
6. The result is returned privately. If the interaction expires during a long job, StarVeil attempts delivery by DM.

## Daily usage and credits
- Regular users receive **5 successful obfuscations per UTC day**. The allowance resets at 00:00 UTC.
- Failed obfuscations do not consume a daily use or credit.
- After the 5 daily uses, each extra credit allows one successful obfuscation.
- Extra credits carry over and do not expire.
- Users can check their balance with `!credits`.
- Admins can check another user's balance with `!credits @user`.
- Admins can grant credits with `!addcredits @user amount`.
- Admins (Discord Administrator permission or IDs listed in `ADMIN_IDS`) have unlimited obfuscations.

Usage is stored in `data/quota.json` and survives bot restarts. Keep this file persistent to preserve balances.

## StarVeil 1.0 settings
- **Rename Locals** — rename local variables and parameters.
- **Encode Strings** — apply string encoding.
- **Scramble Control Flow** — apply control-flow scrambling.
- **Virtual Machine** — compile the transformed script into VM-protected Luau output.
- **Maximum VM Protection** — use the maximum VM level (only applies when Virtual Machine is enabled).

## Compatibility and limits
- This engine targets **Luau** (commonly used for Roblox scripts). It is not a Lua 5.1 obfuscator; legacy Lua 5.1 scripts may fail to parse or may not run as expected.
- Accepted extensions: `.lua`, `.luau`, and `.txt`. The extension does not change the language target.
- Input upload limit: **2 MB**.
- Temporary input and output files are removed after each job.
- VM and maximum-protection settings may take longer depending on script size and host resources.

## Output header
Each output file is prefixed with:
```lua
-- This File Was Protected By StarVeil https://discord.gg/2qzCyb5KUv
```

## License
The engine's MIT license is retained in the cloned `Clyde/LICENSE` file. StarVeil's bot code is maintained separately.
