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
  StringSelectMenuBuilder,
  PermissionFlagsBits,
} = require("discord.js");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, "..");
const TEMP_DIR = path.join(ROOT, "temp");
const DATA_DIR = path.join(ROOT, "data");
const QUOTA_FILE = path.join(DATA_DIR, "quota.json");
const CLYDE_CLI = path.join(ROOT, "Clyde", "dist", "cli", "obfuscate.js");
const MAX_FILE_SIZE = 2 * 1024 * 1024;
const SESSION_TTL = 20 * 60 * 1000;
const ALLOWED_EXTENSIONS = new Set([".lua", ".luau", ".txt"]);
const OUTPUT_HEADER = "-- This File Was Protected By StarVeil https://discord.gg/2qzCyb5KUv";

if (!process.env.DISCORD_TOKEN) {
  throw new Error("DISCORD_TOKEN is missing. Add it to your .env file or Wispbyte environment variables.");
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const sessions = new Map();
const pendingReservations = new Map();
let quotaState = { daily: {}, credits: {} };
let quotaReady;
let quotaWriteQueue = Promise.resolve();

const OPTION_DEFINITIONS = [
  { key: "renameLocals", label: "Rename Locals" },
  { key: "encodeStrings", label: "Encode Strings" },
  { key: "scramble", label: "Scramble Control Flow" },
  { key: "vm", label: "Virtual Machine" },
  { key: "max", label: "Maximum VM Protection" }
];

function utcDayKey() { return new Date().toISOString().slice(0, 10); }
async function loadQuotaState() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const parsed = JSON.parse(await fs.readFile(QUOTA_FILE, "utf8"));
    quotaState = { daily: parsed && parsed.daily && typeof parsed.daily === "object" ? parsed.daily : {}, credits: parsed && parsed.credits && typeof parsed.credits === "object" ? parsed.credits : {} };
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Could not read quota store:", error);
    quotaState = { daily: {}, credits: {} };
    await saveQuotaState();
  }
}
function saveQuotaState() {
  quotaWriteQueue = quotaWriteQueue.catch(() => {}).then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tempFile = QUOTA_FILE + "." + process.pid + ".tmp";
    await fs.writeFile(tempFile, JSON.stringify(quotaState, null, 2), "utf8");
    await fs.rename(tempFile, QUOTA_FILE);
  });
  return quotaWriteQueue;
}
function isAdminUser(userId, permissions) {
  const configured = (process.env.ADMIN_IDS || "").split(",").map(value => value.trim()).filter(Boolean);
  return configured.includes(userId) || Boolean(permissions && permissions.has && permissions.has(PermissionFlagsBits.Administrator));
}
function getPendingFor(userId) { return pendingReservations.get(userId) || []; }
async function reserveObfuscation(userId, admin) {
  await quotaReady;
  if (admin) return { userId, type: "admin", finished: false };
  const today = utcDayKey();
  let record = quotaState.daily[userId];
  if (!record || record.day !== today) record = { day: today, count: 0 };
  quotaState.daily[userId] = record;
  const pending = getPendingFor(userId);
  const pendingDaily = pending.filter(item => item.type === "daily").length;
  const pendingCredits = pending.filter(item => item.type === "credit").length;
  let type;
  if (record.count + pendingDaily < 5) type = "daily";
  else {
    const credits = Math.max(0, Number(quotaState.credits[userId]) || 0);
    if (credits - pendingCredits < 1) return null;
    type = "credit";
  }
  const reservation = { userId, type, finished: false };
  pending.push(reservation);
  pendingReservations.set(userId, pending);
  return reservation;
}
async function finishReservation(reservation, success) {
  if (!reservation || reservation.finished) return;
  reservation.finished = true;
  if (reservation.type === "admin") return;
  const pending = getPendingFor(reservation.userId).filter(item => item !== reservation);
  if (pending.length) pendingReservations.set(reservation.userId, pending); else pendingReservations.delete(reservation.userId);
  if (!success) return;
  if (reservation.type === "daily") {
    const today = utcDayKey();
    let record = quotaState.daily[reservation.userId];
    if (!record || record.day !== today) record = { day: today, count: 0 };
    record.count += 1;
    quotaState.daily[reservation.userId] = record;
  } else {
    quotaState.credits[reservation.userId] = Math.max(0, Number(quotaState.credits[reservation.userId]) || 0) - 1;
  }
  await saveQuotaState();
}
async function getQuotaSummary(userId) {
  await quotaReady;
  const record = quotaState.daily[userId];
  const used = record && record.day === utcDayKey() ? Math.max(0, Number(record.count) || 0) : 0;
  const credits = Math.max(0, Number(quotaState.credits[userId]) || 0);
  return { used, remaining: Math.max(0, 5 - used), credits };
}
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
  return new EmbedBuilder().setColor(0x202225).setTitle("STARVEIL")
    .setDescription("Upload a Luau script to protect it with StarVeil.")
    .setFooter({ text: "StarVeil • Luau Protection" });
}
function privateNoticeEmbed() {
  return new EmbedBuilder().setColor(0x5865f2).setTitle("STARVEIL")
    .setDescription("Upload your script to unlock the controls.");
}
function providerComponents(sessionId) {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`pe:provider:${sessionId}`)
        .setPlaceholder("Choose an obfuscator").setMinValues(1).setMaxValues(1)
        .addOptions({ label: "StarVeil 1.0", value: "starveil", description: "Luau protection engine" })
    ),
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`pe:cancel:${sessionId}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary))
  ];
}
function settingsEmbed(session) {
  const fileName = session.attachment?.name || "No file";
  const enabled = OPTION_DEFINITIONS.filter(option => session.options[option.key]).map(option => option.label);
  return new EmbedBuilder().setColor(0x5865f2).setTitle("STARVEIL 1.0 SETTINGS")
    .setDescription([`**File:** ${fileName}`, "**Engine:** StarVeil 1.0",
      `**Enabled:** ${enabled.join(", ") || "Basic obfuscation"}`, "**Target:** Luau"].join("\\n"));
}
function settingsComponents(session) {
  return [
    new ActionRowBuilder().addComponents(OPTION_DEFINITIONS.map(option =>
      new ButtonBuilder().setCustomId(`pe:option:${session.id}:${option.key}`)
        .setLabel(`${session.options[option.key] ? "✓ " : ""}${option.label}`)
        .setStyle(session.options[option.key] ? ButtonStyle.Primary : ButtonStyle.Secondary))),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`pe:start:${session.id}`).setLabel("START OBFUSCATION").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`pe:cancel:${session.id}`).setLabel("Cancel").setStyle(ButtonStyle.Danger))
  ];
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
  if (!ALLOWED_EXTENSIONS.has(extension)) { sessions.delete(session.id); await interaction.editReply({ content: "Please upload a `.lua`, `.luau`, or `.txt` file." }); return; }
  if (attachment.size > MAX_FILE_SIZE) { sessions.delete(session.id); await interaction.editReply({ content: "That file is larger than the 2 MB limit." }); return; }
  const admin = isAdminUser(interaction.user.id, interaction.memberPermissions);
  const reservation = await reserveObfuscation(interaction.user.id, admin);
  if (!reservation) {
    sessions.delete(session.id);
    await interaction.editReply({ content: "You've used your 5 free obfuscations for today and have no credits left. Use `!credits` to check your balance. Your daily allowance resets at 00:00 UTC." });
    return;
  }
  const id = randomUUID();
  const inputPath = path.join(TEMP_DIR, `${id}${extension}`);
  const outputPath = path.join(TEMP_DIR, `${id}.starveil.lua`);
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await downloadAttachment(attachment, inputPath);
    const args = [inputPath, "--output", outputPath];
    if (!session.options.renameLocals) args.push("--no-rename");
    if (session.options.encodeStrings) args.push("--encode-strings");
    if (session.options.scramble) args.push("--scramble");
    if (session.options.vm) args.push("--vm");
    if (session.options.vm && session.options.max) args.push("--max");
    await execFileAsync(process.execPath, [CLYDE_CLI, ...args], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
    const outputStats = await fs.stat(outputPath).catch(() => null);
    if (!outputStats || !outputStats.isFile() || outputStats.size === 0) throw new Error("StarVeil 1.0 did not produce an output file.");
    const obfuscated = await fs.readFile(outputPath, "utf8");
    await fs.writeFile(outputPath, `${OUTPUT_HEADER}\n${obfuscated}`, "utf8");
    const baseName = path.basename(originalName, extension).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "script";
    const outputName = `${baseName} obf.lua`;
    const result = new AttachmentBuilder(outputPath, { name: outputName });
    const payload = { content: `**StarVeil protection complete.**\nOutput: **${outputName}**`, files: [result] };
    try { await interaction.editReply(payload); } catch (replyError) { await interaction.user.send(payload); }
    await finishReservation(reservation, true);
  } catch (error) {
    console.error("Obfuscation failed:", error);
    const message = "Obfuscation failed. No daily use or credit was consumed. Check that the script uses valid Luau syntax and try again.";
    await interaction.editReply({ content: message }).catch(async () => { await interaction.user.send(message).catch(() => {}); });
    await finishReservation(reservation, false);
  } finally {
    await Promise.all([fs.rm(inputPath, { force: true }).catch(() => {}), fs.rm(outputPath, { force: true }).catch(() => {})]);
    sessions.delete(session.id);
  }
}
quotaReady = loadQuotaState();

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
      await interaction.reply({ content: "StarVeil's obfuscator panel has been posted.", ephemeral: true });
      return;
    }

    if (interaction.isButton() && interaction.customId === "pe:open") {
      pruneSessions();
      const id = randomUUID().slice(0, 12);
      const session = {
        id,
        userId: interaction.user.id,
        provider: null,
        options: { renameLocals: true, encodeStrings: true, scramble: true, vm: true, max: false },
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

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("pe:provider:")) {
      const id = interaction.customId.split(":")[2];
      const session = getOwnedSession(interaction, id);
      if (!session) return interaction.reply({ content: "This session expired. Press the panel button again.", ephemeral: true });
      if (!interaction.values.includes("starveil")) return interaction.reply({ content: "That obfuscator is not available yet.", ephemeral: true });
      session.provider = "starveil";
      await interaction.update({
        embeds: [privateNoticeEmbed().setDescription("StarVeil 1.0 selected. Upload your script to continue.")],
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
      if (session.provider !== "starveil") return interaction.reply({ content: "Select the protection engine first.", ephemeral: true });
      await interaction.showModal(uploadModal(id));
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("pe:option:")) {
      const [, , id, optionKey] = interaction.customId.split(":");
      const session = getOwnedSession(interaction, id);
      if (!session) return interaction.reply({ content: "This session expired. Press the panel button again.", ephemeral: true });
      if (!OPTION_DEFINITIONS.some(option => option.key === optionKey)) return interaction.reply({ content: "That setting is unavailable.", ephemeral: true });
      session.options[optionKey] = !session.options[optionKey];
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

client.on(Events.MessageCreate, async message => {
  try {
    if (message.author.bot || !message.inGuild() || !message.content.startsWith("!")) return;
    const args = message.content.trim().slice(1).split(/\s+/);
    const command = (args.shift() || "").toLowerCase();
    const admin = isAdminUser(message.author.id, message.member && message.member.permissions);
    if (command === "credits") {
      const targetMention = message.mentions.users.first();
      const targetId = args.find(value => /^\d{15,22}$/.test(value));
      if ((targetMention || targetId) && !admin) { await message.reply("Only admins can check another user's credits."); return; }
      const target = targetMention || (targetId ? await client.users.fetch(targetId).catch(() => null) : null) || message.author;
      const balance = await getQuotaSummary(target.id);
      const targetIsAdmin = target.id === message.author.id ? admin : isAdminUser(target.id);
      await message.reply(`**${target.tag} — StarVeil credits**\nDaily uses remaining: **${balance.remaining}/5**\nExtra credits: **${balance.credits}**${targetIsAdmin ? "\nAdmin: **Unlimited obfuscations**" : ""}`);
      return;
    }
    if (command === "addcredits") {
      if (!admin) { await message.reply("You need Administrator permission to use `!addcredits`."); return; }
      const targetMention = message.mentions.users.first();
      const targetId = args.find(value => /^\d{15,22}$/.test(value));
      const target = targetMention || (targetId ? await client.users.fetch(targetId).catch(() => null) : null);
      const amountText = args.find(value => /^\d+$/.test(value) && value !== targetId);
      const amount = Number(amountText);
      if (!target || !Number.isSafeInteger(amount) || amount < 1 || amount > 1000000) {
        await message.reply("Usage: `!addcredits @user amount` (amount must be 1–1,000,000).");
        return;
      }
      await quotaReady;
      quotaState.credits[target.id] = Math.max(0, Number(quotaState.credits[target.id]) || 0) + amount;
      await saveQuotaState();
      await message.reply(`Added **${amount}** StarVeil obfuscation credit(s) to **${target.tag}**. New balance: **${quotaState.credits[target.id]}**.`);
    }
  } catch (error) {
    console.error("Prefix command error:", error);
    await message.reply("The command failed. Please try again.").catch(() => {});
  }
});
client.login(process.env.DISCORD_TOKEN);
