require("dotenv").config();

const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID) {
  throw new Error("DISCORD_TOKEN and CLIENT_ID must be set in .env or Wispbyte environment variables.");
}

const commands = [
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Post the StarVeil private obfuscator panel")
    .toJSON()
];

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
const route = GUILD_ID
  ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
  : Routes.applicationCommands(CLIENT_ID);

rest.put(route, { body: commands })
  .then(() => console.log(`Registered /panel ${GUILD_ID ? `for guild ${GUILD_ID}` : "globally"}.`))
  .catch(error => {
    console.error("Failed to register slash command:", error);
    process.exitCode = 1;
  });
