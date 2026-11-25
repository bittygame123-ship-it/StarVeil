require("dotenv").config();

const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  FileUploadBuilder,
  GatewayIntentBits,
  LabelBuilder,
  ModalBuilder,
} = require("discord.js");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, "..");
const TEMP_DIR = path.join(ROOT, "temp");
const LUA_BIN = path.join(ROOT, "bin", "lua");
const PROMETHEUS_CLI = path.join(ROOT, "Prometheus", "cli.lua");
const MAX_FILE_SIZE = 2 * 1024 * 1024;
const SESSION_TTL = 20 * 60 * 1000;
const ALLOWED_EXTENSIONS = new Set([".lua", ".luau", ".txt"]);
const OUTPUT_HEADER = "-- The File Was Protected By Project Eternal https://discord.com/invite/XTsS4jhEbJ";

if (!process.env.DISCORD_TOKEN) {
  throw new Error("DISCORD_TOKEN is missing. Add it to your .env file or Wispbyte environment variables.");
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const sessions = new Map();

const STEP_OPTIONS = [
  { label: "Encrypt Strings", value: "EncryptStrings", description: "Encrypt string literals and add runtime decoding." },
  { label: "Constant Array", value: "ConstantArray", description: "Move constants into a transformed lookup array." },
  { label: "Numbers To Expressions", value: "NumbersToExpressions", description: "Rewrite numeric literals as expressions." },
  { label: "Anti-Tamper", value: "AntiTamper", description: "Add integrity and anti-hook checks." },
  { label: "Control Flow Flattening", value: "Cff", description: "Flatten control flow into dispatcher blocks." },
  { label: "Virtual Machine (VMify)", value: "Vmify", description: "Compile code into Prometheus's register VM." },
  { label: "Wrap In Function", value: "WrapInFunction", description: "Wrap the script body in a function call." },
  { label: "Split Strings", value: "SplitStrings", description: "Split string literals and rebuild them at runtime." },
  { label: "Proxify Locals", value: "ProxifyLocals", description: "Route local variable accesses through proxies." },
  { label: "Add Vararg", value: "AddVararg", description: "Append varargs to eligible function signatures." }
];

const DEFAULT_STEPS = [
  "Vmify", "EncryptStrings", "AntiTamper", "ConstantArray",
  "WrapInFunction", "Cff", "NumbersToExpressions"
];
const CONSTANT_OPTIONS = [
  { label: "Strings Only", value: "stringsOnly", description: "Only move string constants into the array." },
  { label: "Shuffle Constants", value: "shuffle", description: "Shuffle constant-array positions." },
  { label: "Rotate Constants", value: "rotate", description: "Rotate the array at runtime." }
];
const NAME_GENERATORS = [
  { label: "Mangled Shuffled (recommended)", value: "MangledShuffled" },
  { label: "Mangled", value: "Mangled" },
  { label: "Confuse", value: "Confuse" },
  { label: "Il", value: "Il" },
  { label: "Number", value: "Number" }
];

function pruneSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.updatedAt > SESSION_TTL) sessions.delete(id);
  }
}

function touch(session) {
  session.updatedAt = Date.now();
}

function getOwnedSession(interaction, sessionId) {
  pruneSessions();
  const session = sessions.get(sessionId);
  if (!session || session.userId !== interaction.user.id) return null;
  touch(session);
  return session;
}

function panelEmbed() {
  return new EmbedBuilder()
    .setColor(0x202225)
    .setTitle("PROJECT ETERNAL")
    .setDescription("Upload a Lua/Luau script to protect it with Project Eternal.")
    .setFooter({ text: "Project Eternal" });
}

function privateNoticeEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("PROJECT ETERNAL")
    .setDescription("Upload your script to unlock the controls.");
}

function providerComponents(sessionId) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pe:provider:${sessionId}`)
      .setLabel("Eternal Engine")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`pe:cancel:${sessionId}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  )];
}

function settingsEmbed(session) {
  const stepCount = session.steps.length;
  const fileName = session.attachment?.name || "No file";
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("OBFUSCATOR SETTINGS")
    .setDescription([
      `**File:** ${fileName}`,
      `**Steps:** ${stepCount}/${STEP_OPTIONS.length}`,
      `**Constants:** ${session.constantOptions.length}/3`,
      `**Names:** ${session.nameGenerator}`,
      `**Target:** ${session.luaVersion}`
    ].join("\n"));
}

function settingsComponents(session) {
  const rows = [];
  for (let i = 0; i < STEP_OPTIONS.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(
      STEP_OPTIONS.slice(i, i + 5).map(option =>
        new ButtonBuilder()
          .setCustomId(`pe:step:${session.id}:${option.value}`)
          .setLabel(`${session.steps.includes(option.value) ? "✓ " : ""}${option.label}`)
          .setStyle(session.steps.includes(option.value) ? ButtonStyle.Success : ButtonStyle.Secondary)
      )
    ));
  }

  rows.push(new ActionRowBuilder().addComponents(
    ...CONSTANT_OPTIONS.map(option =>
      new ButtonBuilder()
        .setCustomId(`pe:constant:${session.id}:${option.value}`)
        .setLabel(`${session.constantOptions.includes(option.value) ? "✓ " : ""}${option.label}`)
        .setStyle(session.constantOptions.includes(option.value) ? ButtonStyle.Success : ButtonStyle.Secondary)
    )
  ));

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pe:name:${session.id}`)
      .setLabel(`Names: ${session.nameGenerator}`)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`pe:lua:${session.id}`)
      .setLabel(`Target: ${session.luaVersion}`)
      .setStyle(ButtonStyle.Secondary)
  ));

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pe:start:${session.id}`)
      .setLabel("START OBFUSCATION")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`pe:cancel:${session.id}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger)
  ));
  return rows;
}

function luaString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function buildPrometheusConfig(session) {
  const steps = [];
  const selected = new Set(session.steps);

  // Keep the sequence aligned with Prometheus's current Medium pipeline where possible.
  // Optional AST transforms that should run before VM compilation are placed first.
  if (selected.has("SplitStrings")) {
    steps.push('{ Name = "SplitStrings", Settings = { Threshold = 1, MinLength = 5, MaxLength = 5, ConcatenationType = "custom", CustomFunctionType = "global", CustomLocalFunctionsCount = 2 } }');
  }
  if (selected.has("AddVararg")) {
    steps.push('{ Name = "AddVararg", Settings = {} }');
  }
  if (selected.has("ProxifyLocals")) {
    steps.push('{ Name = "ProxifyLocals", Settings = { LiteralType = "string" } }');
  }
  if (selected.has("Vmify")) {
    steps.push('{ Name = "Vmify", Settings = {} }');
  }
  if (selected.has("EncryptStrings")) {
    steps.push(`{ Name = "EncryptStrings", Settings = { HoistVmStrings = ${selected.has("Vmify") ? "true" : "false"} } }`);
  }
  if (selected.has("AntiTamper")) {
    steps.push('{ Name = "AntiTamper", Settings = { UseDebug = false } }');
  }
  if (selected.has("ConstantArray")) {
    const constantSettings = [
      "Threshold = 1",
      `StringsOnly = ${session.constantOptions.includes("stringsOnly") ? "true" : "false"}`,
      `Shuffle = ${session.constantOptions.includes("shuffle") ? "true" : "false"}`,
      `Rotate = ${session.constantOptions.includes("rotate") ? "true" : "false"}`,
      "LocalWrapperThreshold = 0"
    ].join(", ");
    steps.push(`{ Name = "ConstantArray", Settings = { ${constantSettings} } }`);
  }
  if (selected.has("WrapInFunction")) {
    steps.push('{ Name = "WrapInFunction", Settings = { Iterations = 1 } }');
  }
  if (selected.has("Cff")) {
    steps.push(`{ Name = "Cff", Settings = { ExcludeVm = ${selected.has("Vmify") ? "true" : "false"} } }`);
  }
  if (selected.has("NumbersToExpressions")) {
    steps.push('{ Name = "NumbersToExpressions", Settings = { Threshold = 1, InternalThreshold = 0.2 } }');
  }

  return [
    "return {",
    `  LuaVersion = ${luaString(session.luaVersion)},`,
    '  VarNamePrefix = "",',
    `  NameGenerator = ${luaString(session.nameGenerator)},`,
    "  PrettyPrint = false,",
    "  Seed = 0,",
    "  Steps = {",
    steps.map(step => `    ${step},`).join("\n"),
    "  }",
    "}"
  ].join("\n") + "\n";
}

function uploadModal(sessionId) {
  const modal = new ModalBuilder()
    .setCustomId(`pe:upload:${sessionId}`)
    .setTitle("Upload Lua Script")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Lua / Luau file (max 2 MB)")
        .setDescription("Accepted extensions: .lua, .luau, .txt")
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId("script")
            .setMinValues(1)
            .setMaxValues(1)
            .setRequired(true)
        )
    );
  return modal;
}

async function downloadAttachment(attachment, destination) {
  if (!attachment.url) throw new Error("Discord did not provide a download URL.");
  if (attachment.size > MAX_FILE_SIZE) throw new Error("The uploaded file exceeds the 2 MB limit.");

  const response = await fetch(attachment.url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Could not download the uploaded file (HTTP ${response.status}).`);

  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_FILE_SIZE) throw new Error("The uploaded file exceeds the 2 MB limit.");

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error("The uploaded file is empty.");
  if (buffer.length > MAX_FILE_SIZE) throw new Error("The uploaded file exceeds the 2 MB limit.");
  await fs.writeFile(destination, buffer, { flag: "wx" });
}

async function runObfuscation(interaction, session, attachment) {
  const originalName = attachment.name || "script.lua";
  const extension = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    sessions.delete(session.id);
    await interaction.editReply({ content: "Please upload a `.lua`, `.luau`, or `.txt` file." });
    return;
  }
  if (attachment.size > MAX_FILE_SIZE) {
    sessions.delete(session.id);
    await interaction.editReply({ content: "That file is larger than the 2 MB limit." });
    return;
  }

  await fs.mkdir(TEMP_DIR, { recursive: true });
  const id = randomUUID();
  const inputPath = path.join(TEMP_DIR, `${id}${extension}`);
  const outputPath = path.join(TEMP_DIR, `${id}.prometheus.lua`);
  const configPath = path.join(TEMP_DIR, `${id}.config.lua`);

  try {
    await downloadAttachment(attachment, inputPath);
    await fs.writeFile(configPath, buildPrometheusConfig(session), { flag: "wx" });

    await execFileAsync(
      LUA_BIN,
      [PROMETHEUS_CLI, "--config", configPath, inputPath, "--out", outputPath],
      {
        cwd: ROOT,
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true
      }
    );

    const outputStats = await fs.stat(outputPath).catch(() => null);
    if (!outputStats || !outputStats.isFile() || outputStats.size === 0) {
      throw new Error("Prometheus did not produce an output file.");
    }

    const obfuscated = await fs.readFile(outputPath, "utf8");
    await fs.writeFile(outputPath, `${OUTPUT_HEADER}\n${obfuscated}`, "utf8");

    const baseName = path.basename(originalName, extension)
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 80) || "script";
    const outputName = `${baseName} obf.lua`;
    const result = new AttachmentBuilder(outputPath, { name: outputName });

    await interaction.editReply({
      content: `**Protection complete.**\nOutput: **${outputName}**`,
      files: [result]
    });
  } catch (error) {
    console.error("Obfuscation failed:", error);
    const message = error.killed
      ? "Protection timed out after 30 seconds. Try fewer transformations or a smaller script."
      : "Obfuscation failed. Check that the script is valid for the selected Lua target and try a different combination of transformations.";
    await interaction.editReply({ content: message }).catch(() => {});
  } finally {
    await Promise.all([
      fs.rm(inputPath, { force: true }).catch(() => {}),
      fs.rm(outputPath, { force: true }).catch(() => {}),
      fs.rm(configPath, { force: true }).catch(() => {})
    ]);
    sessions.delete(session.id);
  }
}

client.once(Events.ClientReady, readyClient => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "panel") {
      if (!interaction.inGuild() || !interaction.channel?.send) {
        await interaction.reply({ content: "Use `/panel` in a server text channel.", ephemeral: true });
        return;
      }
      await interaction.channel.send({
        embeds: [panelEmbed()],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("pe:open")
            .setLabel("OBFUSCATE")
            .setStyle(ButtonStyle.Primary)
            .setEmoji("🛡️")
        )]
      });
      await interaction.reply({ content: "Project Eternal's obfuscator panel has been posted.", ephemeral: true });
      return;
    }

    if (interaction.isButton() && interaction.customId === "pe:open") {
      pruneSessions();
      const id = randomUUID().slice(0, 12);
      const session = {
        id,
        userId: interaction.user.id,
        provider: null,
        steps: [...DEFAULT_STEPS],
        constantOptions: ["stringsOnly", "shuffle", "rotate"],
        nameGenerator: "MangledShuffled",
        luaVersion: "Lua51",
        updatedAt: Date.now()
      };
      sessions.set(id, session);
      await interaction.reply({
        ephemeral: true,
        embeds: [privateNoticeEmbed().setTitle("Choose Your Obfuscator").setDescription("Choose the protection engine to continue.")],
        components: providerComponents(id)
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("pe:provider:")) {
      const id = interaction.customId.split(":")[2];
      const session = getOwnedSession(interaction, id);
      if (!session) return interaction.reply({ content: "This session expired. Press the panel button again.", ephemeral: true });
      session.provider = "prometheus";
      await interaction.update({
        embeds: [privateNoticeEmbed().setDescription("Eternal Engine selected. Upload your script to continue.")],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`pe:upload:${id}`)
            .setLabel("UPLOAD SCRIPT")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`pe:cancel:${id}`)
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary)
        )]
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("pe:upload:")) {
      const id = interaction.customId.split(":")[2];
      const session = getOwnedSession(interaction, id);
      if (!session) return interaction.reply({ content: "This session expired. Press the panel button again.", ephemeral: true });
      if (session.provider !== "prometheus") return interaction.reply({ content: "Select the protection engine first.", ephemeral: true });
      await interaction.showModal(uploadModal(id));
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("pe:step:")) {
      const [, , id, ...stepParts] = interaction.customId.split(":");
      const step = stepParts.join(":");
      const session = getOwnedSession(interaction, id);
      if (!session) return interaction.reply({ content: "This session expired. Press the panel button again.", ephemeral: true });
      session.steps = session.steps.includes(step)
        ? session.steps.filter(value => value !== step)
        : [...session.steps, step];
      await interaction.update({ embeds: [settingsEmbed(session)], components: settingsComponents(session) });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("pe:constant:")) {
      const [, , id, option] = interaction.customId.split(":");
      const session = getOwnedSession(interaction, id);
      if (!session) return interaction.reply({ content: "This session expired. Press the panel button again.", ephemeral: true });
      session.constantOptions = session.constantOptions.includes(option)
        ? session.constantOptions.filter(value => value !== option)
        : [...session.constantOptions, option];
      await interaction.update({ embeds: [settingsEmbed(session)], components: settingsComponents(session) });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("pe:name:")) {
      const id = interaction.customId.split(":")[2];
      const session = getOwnedSession(interaction, id);
      if (!session) return interaction.reply({ content: "This session expired. Press the panel button again.", ephemeral: true });
      const index = NAME_GENERATORS.findIndex(option => option.value === session.nameGenerator);
      session.nameGenerator = NAME_GENERATORS[(index + 1) % NAME_GENERATORS.length].value;
      await interaction.update({ embeds: [settingsEmbed(session)], components: settingsComponents(session) });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("pe:lua:")) {
      const id = interaction.customId.split(":")[2];
      const session = getOwnedSession(interaction, id);
      if (!session) return interaction.reply({ content: "This session expired. Press the panel button again.", ephemeral: true });
      session.luaVersion = session.luaVersion === "Lua51" ? "LuaU" : "Lua51";
      await interaction.update({ embeds: [settingsEmbed(session)], components: settingsComponents(session) });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("pe:start:")) {
      const id = interaction.customId.split(":")[2];
      const session = getOwnedSession(interaction, id);
      if (!session) return interaction.reply({ content: "This session expired. Press the panel button again.", ephemeral: true });
      if (!session.attachment) {
        return interaction.reply({ content: "Upload your script before starting.", ephemeral: true });
      }
      await interaction.update({ content: "Your file is being obfuscated…", embeds: [], components: [] });
      await runObfuscation(interaction, session, session.attachment);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("pe:cancel:")) {
      const id = interaction.customId.split(":")[2];
      const session = getOwnedSession(interaction, id);
      if (session) sessions.delete(id);
      await interaction.update({
        embeds: [privateNoticeEmbed().setTitle("Session Cancelled").setDescription("Your private obfuscation session has been cancelled.")],
        components: []
      });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("pe:upload:")) {
      const id = interaction.customId.split(":")[2];
      const session = getOwnedSession(interaction, id);
      if (!session) {
        await interaction.reply({ content: "This session expired. Press the panel button again.", ephemeral: true });
        return;
      }
      const uploadedFiles = interaction.fields.getUploadedFiles("script", true);
      const attachment = uploadedFiles.first();
      if (!attachment) {
        await interaction.reply({ content: "Please attach one script file.", ephemeral: true });
        return;
      }
      const extension = path.extname(attachment.name || "").toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(extension) || attachment.size > MAX_FILE_SIZE) {
        await interaction.reply({ content: "Upload a .lua, .luau, or .txt file under 2 MB.", ephemeral: true });
        return;
      }
      session.attachment = attachment;
      await interaction.reply({
        ephemeral: true,
        embeds: [settingsEmbed(session)],
        components: settingsComponents(session)
      });
    }
  } catch (error) {
    console.error("Interaction handler error:", error);
    const response = { content: "Something went wrong while handling that interaction. Please try again.", ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(response).catch(() => {});
    } else {
      await interaction.reply(response).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
