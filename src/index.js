import "dotenv/config";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits,
} from "discord.js";
import { RankDatabase } from "./database.js";
import { createRolePanel } from "./panel.js";
import {
  formatCount,
  formatHours,
  highestConfiguredRank,
  highestEligibleRank,
  RANKS,
} from "./ranks.js";
import { VoiceTracker } from "./voice-tracker.js";

const PREFIX = "+";
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "./data");

if (!TOKEN) {
  console.error("Missing DISCORD_BOT_TOKEN environment variable.");
  process.exit(1);
}

mkdirSync(DATA_DIR, { recursive: true });
const database = new RankDatabase(path.join(DATA_DIR, "moko-rank.sqlite"));
const voiceTracker = new VoiceTracker(database);
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const cycleLocks = new Map();
const memberRoleLocks = new Map();

async function withCycleLock(guildId, operation) {
  const previous = cycleLocks.get(guildId) ?? Promise.resolve();
  const current = previous.then(operation, operation);
  cycleLocks.set(guildId, current);
  try {
    return await current;
  } finally {
    if (cycleLocks.get(guildId) === current) cycleLocks.delete(guildId);
  }
}

async function ensureCurrentCycle(guild) {
  return withCycleLock(guild.id, async () => {
    let settings = database.ensureGuild(guild.id);
    const now = Date.now();

    while (settings.nextResetAt <= now) {
      const resetAt = settings.nextResetAt;
      voiceTracker.flushGuildAt(guild.id, resetAt);
      const userIds = database.getTrackedUserIds(guild.id);
      await removeConfiguredRoles(guild, userIds, settings.roleIds);
      database.resetCycle(guild.id, resetAt);
      console.info(
        `Quota cycle reset for guild ${guild.id} at ${new Date(resetAt).toISOString()}.`
      );
      settings = database.ensureGuild(guild.id);
    }

    return settings;
  });
}

async function removeConfiguredRoles(guild, userIds, roleIds) {
  const configuredRoleIds = [...new Set(roleIds.filter(Boolean))];
  if (!configuredRoleIds.length || !userIds.length) return;

  for (const userId of userIds) {
    try {
      const member =
        guild.members.cache.get(userId) ??
        (await guild.members.fetch(userId).catch(() => null));
      if (!member) continue;
      const rolesToRemove = configuredRoleIds.filter((roleId) =>
        member.roles.cache.has(roleId)
      );
      if (rolesToRemove.length) {
        await member.roles.remove(
          rolesToRemove,
          "Fin du cycle de quotas de 14 jours."
        );
      }
    } catch (error) {
      console.error(
        `Could not remove configured rank roles for member ${userId} in guild ${guild.id}.`,
        error
      );
    }
  }
}

async function removeUnmanagedRoleFromTrackedMembers(guild, roleId) {
  if (!roleId) return;
  for (const userId of database.getTrackedUserIds(guild.id)) {
    try {
      const member =
        guild.members.cache.get(userId) ??
        (await guild.members.fetch(userId).catch(() => null));
      if (member?.roles.cache.has(roleId)) {
        await member.roles.remove(
          roleId,
          "Ce rôle n'est plus géré par Moko Rank."
        );
      }
    } catch (error) {
      console.error(
        `Could not remove an unconfigured rank role from member ${userId} in guild ${guild.id}.`,
        error
      );
    }
  }
}

function statsWithLiveVoice(guildId, userId) {
  const stats = database.getStats(guildId, userId);
  stats.voiceMs += voiceTracker.activeDuration(guildId, userId);
  return stats;
}

async function applyMemberRank(member) {
  const settings = database.ensureGuild(member.guild.id);
  const availableRoleIds = settings.roleIds.map((roleId) =>
    roleId && member.guild.roles.cache.has(roleId) ? roleId : null
  );
  const stats = statsWithLiveVoice(member.guild.id, member.id);
  const rank = highestConfiguredRank(stats, availableRoleIds);
  const targetRoleId = rank ? availableRoleIds[rank.level - 1] : null;
  const managedRoleIds = [...new Set(availableRoleIds.filter(Boolean))];

  if (targetRoleId && !member.roles.cache.has(targetRoleId)) {
    const targetRole = member.guild.roles.cache.get(targetRoleId);
    const botMember =
      member.guild.members.me ?? (await member.guild.members.fetchMe());
    if (
      !targetRole ||
      !botMember ||
      targetRole.position >= botMember.roles.highest.position
    ) {
      console.warn(
        `Cannot assign rank ${rank.level} in guild ${member.guild.id}; move the bot role above the configured role.`
      );
      return;
    }
    await member.roles.add(
      targetRole,
      `Quota du palier ${rank.level} atteint.`
    );
  }

  const rolesToRemove = managedRoleIds.filter(
    (roleId) =>
      roleId !== targetRoleId && member.roles.cache.has(roleId)
  );
  if (rolesToRemove.length) {
    await member.roles.remove(
      rolesToRemove,
      "Mise à jour du rang de quotas."
    );
  }
}

async function syncMemberRank(member) {
  const key = `${member.guild.id}:${member.id}`;
  const previous = memberRoleLocks.get(key) ?? Promise.resolve();
  const current = previous.then(
    () => applyMemberRank(member),
    () => applyMemberRank(member)
  );
  memberRoleLocks.set(key, current);
  try {
    await current;
  } finally {
    if (memberRoleLocks.get(key) === current) memberRoleLocks.delete(key);
  }
}

async function safelySyncMemberRank(member) {
  try {
    await syncMemberRank(member);
  } catch (error) {
    console.error(
      `Could not update rank for member ${member.id} in guild ${member.guild.id}.`,
      error
    );
  }
}

async function refreshTrackedMembers(guild) {
  const userIds = database.getTrackedUserIds(guild.id);
  for (const userId of userIds) {
    const member =
      guild.members.cache.get(userId) ??
      (await guild.members.fetch(userId).catch(() => null));
    if (member) await safelySyncMemberRank(member);
  }
}

function formatResetDate(timestamp) {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function createStatsEmbed(member, settings) {
  const stats = statsWithLiveVoice(member.guild.id, member.id);
  const reached = highestEligibleRank(stats);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`Progression de ${member.displayName}`)
    .setThumbnail(member.user.displayAvatarURL())
    .setDescription(
      reached
        ? `Palier atteint : **${reached.level} / ${RANKS.length}**`
        : "Aucun palier atteint pour le moment."
    )
    .setFooter({
      text: `Prochaine remise à zéro : ${formatResetDate(settings.nextResetAt)}`,
    });

  for (const rank of RANKS) {
    const metMessages = stats.messages >= rank.messages;
    const metVoice =
      stats.voiceMs >= rank.voiceHours * 60 * 60 * 1000;
    embed.addFields({
      name: `Palier ${rank.level}`,
      value:
        `Messages : **${formatCount(stats.messages)} / ${formatCount(rank.messages)}**\n` +
        `Vocal : **${formatHours(stats.voiceMs)} h / ${rank.voiceHours} h**\n` +
        `État : ${metMessages && metVoice ? "atteint" : "en cours"}`,
      inline: true,
    });
  }

  return embed;
}

function createHelpEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Commandes de Moko Rank")
    .setDescription("Préfixe du bot : `+`")
    .addFields(
      {
        name: "+help",
        value: "Affiche cette aide.",
        inline: false,
      },
      {
        name: "+stats [@membre]",
        value: "Affiche ta progression ou celle d’un membre.",
        inline: false,
      },
      {
        name: "+panel",
        value:
          "Ouvre le panneau de configuration des rôles (permission Gérer les rôles requise).",
        inline: false,
      },
      {
        name: "+panel retirer <palier>",
        value: "Retire le rôle configuré pour un palier de 1 à 5.",
        inline: false,
      }
    )
    .setFooter({
      text: "Les quotas commencent à l’arrivée du bot et se réinitialisent tous les 14 jours.",
    });
}

function canManageRoles(member) {
  return member.permissions.has(PermissionFlagsBits.ManageRoles);
}

function createRolePanelResponse(guild, settings) {
  return {
    ...createRolePanel(guild, settings),
    content: "Configuration réservée aux membres autorisés à gérer les rôles.",
  };
}

async function handlePanelCommand(message, args) {
  if (!message.member || !canManageRoles(message.member)) {
    await message.reply("Il te faut la permission **Gérer les rôles**.");
    return;
  }

  const settings = await ensureCurrentCycle(message.guild);
  const subcommand = args[0]?.toLowerCase();
  if (subcommand === "retirer" || subcommand === "remove") {
    const level = Number(args[1]);
    if (!Number.isInteger(level) || level < 1 || level > RANKS.length) {
      await message.reply("Utilise `+panel retirer <palier de 1 à 5>`.");
      return;
    }
    const previousRoleId = settings.roleIds[level - 1];
    database.setRankRole(message.guild.id, level, null);
    const updatedSettings = database.ensureGuild(message.guild.id);
    await message.reply(createRolePanelResponse(message.guild, updatedSettings));
    void (async () => {
      await removeUnmanagedRoleFromTrackedMembers(
        message.guild,
        previousRoleId
      );
      await refreshTrackedMembers(message.guild);
    })().catch((error) =>
      console.error(
        `Could not refresh existing ranks for guild ${message.guild.id}.`,
        error
      )
    );
    return;
  }

  await message.reply(createRolePanelResponse(message.guild, settings));
}

async function handlePrefixCommand(message) {
  const body = message.content.slice(PREFIX.length).trim();
  const [command = "", ...args] = body.split(/\s+/);
  const normalizedCommand = command.toLowerCase();

  if (normalizedCommand === "help" || normalizedCommand === "aide") {
    await message.reply({ embeds: [createHelpEmbed()] });
    return;
  }

  if (!message.guild) {
    await message.reply("Cette commande doit être utilisée dans un serveur.");
    return;
  }

  if (normalizedCommand === "panel") {
    await handlePanelCommand(message, args);
    return;
  }

  if (normalizedCommand === "stats" || normalizedCommand === "me") {
    const member =
      message.mentions.members.first() ??
      message.member ??
      (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (!member) {
      await message.reply("Je n’ai pas trouvé ce membre dans le serveur.");
      return;
    }
    const settings = await ensureCurrentCycle(message.guild);
    await message.reply({
      embeds: [createStatsEmbed(member, settings)],
    });
    return;
  }

  await message.reply("Commande inconnue. Utilise `+help`.");
}

client.once("ready", async () => {
  console.info(`Moko Rank is online as ${client.user.tag}.`);
  for (const guild of client.guilds.cache.values()) {
    try {
      database.ensureGuild(guild.id);
      voiceTracker.startFromGuild(guild);
      await ensureCurrentCycle(guild);
    } catch (error) {
      console.error(`Could not initialize guild ${guild.id}.`, error);
    }
  }

  const timer = setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      try {
        await ensureCurrentCycle(guild);
        const activeMembers = voiceTracker.flushGuildAt(guild.id, Date.now());
        for (const member of activeMembers) {
          await safelySyncMemberRank(member);
        }
      } catch (error) {
        console.error(`Periodic update failed for guild ${guild.id}.`, error);
      }
    }
  }, 60_000);
  timer.unref();
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  try {
    if (message.content.startsWith(PREFIX)) {
      await handlePrefixCommand(message);
      return;
    }

    await ensureCurrentCycle(message.guild);
    database.addMessage(message.guild.id, message.author.id);
    const member =
      message.member ??
      (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (member) await safelySyncMemberRank(member);
  } catch (error) {
    console.error(
      `Could not process a message in guild ${message.guild.id}.`,
      error
    );
  }
});

client.on("voiceStateUpdate", async (oldState, newState) => {
  const guild = newState.guild ?? oldState.guild;
  const member = newState.member ?? oldState.member;
  if (!guild || !member || member.user.bot) return;

  try {
    await ensureCurrentCycle(guild);
    const affectedMember = voiceTracker.handleStateChange(oldState, newState);
    if (affectedMember) await safelySyncMemberRank(affectedMember);
  } catch (error) {
    console.error(
      `Could not process a voice update in guild ${guild.id}.`,
      error
    );
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isRoleSelectMenu()) return;
  const match = /^moko:rank-role:([1-5])$/.exec(interaction.customId);
  if (!match || !interaction.guild) return;

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({
      content: "Il te faut la permission **Gérer les rôles**.",
      ephemeral: true,
    });
    return;
  }

  try {
    const settings = await ensureCurrentCycle(interaction.guild);
    const level = Number(match[1]);
    const roleId = interaction.values[0];
    const role = interaction.guild.roles.cache.get(roleId);
    const botMember =
      interaction.guild.members.me ??
      (await interaction.guild.members.fetchMe());

    if (!role || role.id === interaction.guild.id || role.managed) {
      await interaction.reply({
        content: "Ce rôle ne peut pas être attribué par le bot.",
        ephemeral: true,
      });
      return;
    }

    if (role.position >= botMember.roles.highest.position) {
      await interaction.reply({
        content:
          "Déplace le rôle du bot au-dessus de ce rôle dans les paramètres du serveur.",
        ephemeral: true,
      });
      return;
    }

    const duplicateLevel = settings.roleIds.findIndex(
      (configuredId, index) => index !== level - 1 && configuredId === roleId
    );
    if (duplicateLevel !== -1) {
      await interaction.reply({
        content: `Ce rôle est déjà associé au palier ${duplicateLevel + 1}.`,
        ephemeral: true,
      });
      return;
    }

    database.setRankRole(interaction.guild.id, level, roleId);
    const updatedSettings = database.ensureGuild(interaction.guild.id);
    await interaction.update(
      createRolePanelResponse(interaction.guild, updatedSettings)
    );
    await interaction.followUp({
      content: `Le rôle ${role.name} est associé au palier ${level}.`,
      ephemeral: true,
    });
    const previousRoleId = settings.roleIds[level - 1];
    void (async () => {
      if (previousRoleId && previousRoleId !== roleId) {
        await removeUnmanagedRoleFromTrackedMembers(
          interaction.guild,
          previousRoleId
        );
      }
      await refreshTrackedMembers(interaction.guild);
    })().catch((error) =>
      console.error(
        `Could not refresh existing ranks for guild ${interaction.guild.id}.`,
        error
      )
    );
  } catch (error) {
    console.error(
      `Could not save a rank role in guild ${interaction.guild.id}.`,
      error
    );
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: "La configuration du rôle a échoué. Réessaie dans un instant.",
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: "La configuration du rôle a échoué. Réessaie dans un instant.",
        ephemeral: true,
      });
    }
  }
});

client.on("guildCreate", (guild) => {
  database.ensureGuild(guild.id);
  console.info(`Joined guild ${guild.id}.`);
});

client.on("error", (error) => {
  console.error("Discord client error.", error);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`Shutting down after ${signal}.`);
  client.destroy();
  database.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

client.login(TOKEN).catch((error) => {
  console.error("Discord login failed.", error);
  database.close();
  process.exitCode = 1;
});
