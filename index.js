"use strict";

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder,
  GatewayIntentBits, ModalBuilder, Partials, PermissionsBitField,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");
const path = require("node:path");
const {
  atomicSave,
  loadJson,
  parseCount,
  parseDuration,
  prepareDataDirectory,
  xpForLevel,
} = require("./utils");

const PREFIX = "+";
const TOKEN = process.env.DISCORD_TOKEN || process.env.TOKEN;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const DATA_FILES = {
  warns: "warns.json",
  giveaways: "giveaways.json",
  ranks: "ranks.json",
  autorole: "autorole.json",
};

let db = {};
function save(key) { atomicSave(DATA_DIR, DATA_FILES[key], db[key]); }
const cooldowns = new Map();
const endingGiveaways = new Set();
const FLAGS = PermissionsBitField.Flags;
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.GuildMember, Partials.User, Partials.Message, Partials.Channel],
  allowedMentions: { parse: [], repliedUser: false },
});

function isAdmin(member) { return member.permissions.has(FLAGS.Administrator); }
function can(member, permission) { return member.permissions.has(permission); }
function scoped(guildId, userId) { return `${guildId}:${userId}`; }
function clean(text, limit = 1000) {
  return String(text ?? "").replace(/@/g, "@\u200b").slice(0, limit);
}
function mention(member) { return `<@${member.id}>`; }
function commandArgs(message) {
  const match = message.content.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  return match ? [match[1], match[2] || ""] : ["", ""];
}
function embed(title, description, color = 0x7289da) {
  return new EmbedBuilder().setTitle(title).setDescription(description || "—").setColor(color);
}
function reply(message, content) {
  return message.reply({ content, allowedMentions: { parse: [], repliedUser: false } });
}
function getRank(guildId, userId) {
  const key = scoped(guildId, userId);
  if (!db.ranks[key]) db.ranks[key] = { xp: 0, level: 1, messages: 0 };
  return db.ranks[key];
}
function requirePermission(message, permission) {
  if (can(message.member, permission)) return true;
  void reply(message, "Tu n’as pas les permissions nécessaires.");
  return false;
}
function requireAdmin(message) {
  if (isAdmin(message.member)) return true;
  void reply(message, "Cette action est réservée aux administrateurs.");
  return false;
}

const HELP = {
  mod: {
    name: "Modération", color: 0xff3030,
    commands: [
      ["+clear <1–99>", "Supprime les messages récents."],
      ["+kick @membre [raison]", "Expulse un membre."],
      ["+ban @membre [raison]", "Bannit un membre."],
      ["+unban <ID>", "Débannit un utilisateur."],
      ["+mute @membre [minutes]", "Met temporairement en sourdine."],
      ["+unmute @membre", "Retire la sourdine."],
    ],
  },
  warn: {
    name: "Avertissements", color: 0xffa500,
    commands: [
      ["+warn @membre [raison]", "Ajoute un avertissement."],
      ["+unwarn @membre <ID>", "Retire un avertissement."],
      ["+warns @membre", "Affiche les avertissements."],
      ["+clearwarns @membre", "Efface ses avertissements (admin)."],
    ],
  },
  channels: {
    name: "Salons", color: 0x00a86b,
    commands: [
      ["+lock / +unlock", "Verrouille ou déverrouille le salon."],
      ["+slowmode <secondes>", "Règle le mode lent (0–21600)."],
      ["+hide / +show", "Masque ou affiche le salon."],
      ["+nuke", "Recrée le salon (admin)."],
    ],
  },
  info: {
    name: "Informations", color: 0x3578e5,
    commands: [
      ["+serverinfo", "Informations sur le serveur."],
      ["+userinfo [@membre]", "Informations sur un membre."],
      ["+botinfo", "État et latence du bot."],
      ["+ping", "Mesure la latence."],
    ],
  },
  giveaway: {
    name: "Giveaways", color: 0xffd700,
    commands: [
      ["+gstart <durée> <gagnants> <prix>", "Lance un giveaway (ex. 2h)."],
      ["+gend <ID>", "Termine un giveaway."],
      ["+greroll <ID>", "Tire un autre gagnant."],
      ["+gpanel", "Ouvre le panneau interactif."],
    ],
  },
  rank: {
    name: "Niveaux", color: 0x8a2be2,
    commands: [
      ["+rank [@membre]", "Affiche le niveau."],
      ["+leaderboard", "Classe les dix premiers."],
      ["+setlevel @membre <niveau>", "Règle un niveau (admin)."],
      ["+resetrank @membre", "Remet son niveau à zéro (admin)."],
    ],
  },
  autorole: {
    name: "Rôle automatique", color: 0x008080,
    commands: [
      ["+autorole @rôle", "Attribue ce rôle aux nouveaux membres."],
      ["+autorole", "Affiche le rôle actuel."],
      ["+autoroleoff", "Désactive le rôle automatique."],
    ],
  },
  roles: {
    name: "Rôles", color: 0x006400,
    commands: [
      ["+addrole @membre @rôle", "Ajoute un rôle (Manage Roles)."],
      ["+removerole @membre @rôle", "Retire un rôle (Manage Roles)."],
    ],
  },
};

function helpEmbed(category) {
  if (HELP[category]) {
    const page = HELP[category];
    return new EmbedBuilder().setTitle(`Aide — ${page.name}`).setColor(page.color)
      .addFields(page.commands.map(([name, value]) => ({ name: `\`${name}\``, value })));
  }
  return embed("Supreme Bot — Aide", `Préfixe : \`${PREFIX}\`\n${Object.entries(HELP)
    .map(([key, page]) => `• ${page.name} : \`${PREFIX}help ${key}\``).join("\n")}\n\n\`+panel\` : menu interactif.`);
}
function selectRow(customId, placeholder = "Choisis une catégorie…") {
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(customId).setPlaceholder(placeholder)
    .addOptions(Object.entries(HELP).map(([value, page]) => ({ label: page.name, value }))));
}
function giveawayJoinRow(id) {
  return new ActionRowBuilder().addComponents(new ButtonBuilder()
    .setCustomId(`gw:join:${id}`).setLabel("Participer").setStyle(ButtonStyle.Success));
}

async function createGiveaway(channel, hostId, prize, duration, winners) {
  const length = parseDuration(duration);
  if (!length || length > 365 * 86_400_000) throw new Error("Durée invalide (ex. 10m, 2h, 1d).");
  if (!Number.isInteger(winners) || winners < 1 || winners > 20) throw new Error("Le nombre de gagnants doit être compris entre 1 et 20.");
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const giveaway = {
    id, guildId: channel.guild.id, channelId: channel.id, prize: clean(prize, 200),
    winners, hostId, endTime: Date.now() + length, participants: [], ended: false,
  };
  const message = await channel.send({
    embeds: [embed("🎉 Giveaway", `**Prix :** ${giveaway.prize}\n**Gagnants :** ${winners}\n**Fin :** <t:${Math.floor(giveaway.endTime / 1000)}:R>\n**ID :** \`${id}\``, 0xffd700)],
    components: [giveawayJoinRow(id)],
  });
  giveaway.messageId = message.id;
  db.giveaways[`${giveaway.guildId}:${id}`] = giveaway;
  save("giveaways");
  return giveaway;
}

async function endGiveaway(giveaway) {
  const key = `${giveaway.guildId}:${giveaway.id}`;
  if (!db.giveaways[key] || db.giveaways[key].ended || endingGiveaways.has(key)) return;
  endingGiveaways.add(key);
  try {
    giveaway.ended = true;
    save("giveaways");
    const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    if (!giveaway.participants.length) {
      await channel.send(`Le giveaway **${clean(giveaway.prize, 200)}** est terminé : aucun participant.`);
      return;
    }
    const pool = [...giveaway.participants];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const winners = pool.slice(0, Math.min(giveaway.winners, pool.length));
    giveaway.winnerIds = winners;
    save("giveaways");
    await channel.send({
      content: `Giveaway **${clean(giveaway.prize, 200)}** terminé ! Gagnant${winners.length > 1 ? "s" : ""} : ${winners.map(id => `<@${id}>`).join(", ")}`,
      allowedMentions: { users: winners },
    });
    const original = await channel.messages.fetch(giveaway.messageId).catch(() => null);
    if (original) await original.edit({ components: [] }).catch(() => {});
  } finally {
    endingGiveaways.delete(key);
  }
}

const commands = new Map();
function command(names, run) {
  for (const name of names) commands.set(name, run);
}

command(["help", "h"], async (m, args) => {
  const category = args.trim().split(/\s+/)[0]?.toLowerCase();
  await m.reply({ embeds: [helpEmbed(category)], components: [selectRow("help_select")] });
});
command(["panel"], async m => {
  if (!requireAdmin(m)) return;
  await m.reply({
    embeds: [embed("Supreme Bot — Panneau de gestion", "Choisis une catégorie dans le menu ci-dessous.")],
    components: [selectRow("main_menu")],
  });
});
command(["autorole"], async (m, args) => {
  if (!requireAdmin(m)) return;
  const role = m.mentions.roles.first();
  const key = m.guild.id;
  if (!role) {
    const current = db.autorole[key];
    return reply(m, current ? `Rôle actuel : <@&${current}>` : `Aucun rôle automatique. Utilise \`+autorole @rôle\`.`);
  }
  if (role.managed || role.position >= m.guild.members.me.roles.highest.position) return reply(m, "Je ne peux pas attribuer ce rôle : il est géré ou supérieur au mien.");
  db.autorole[key] = role.id;
  save("autorole");
  return reply(m, `Rôle automatique défini sur ${role}.`);
});
command(["autoroleoff"], async m => {
  if (!requireAdmin(m)) return;
  delete db.autorole[m.guild.id]; save("autorole");
  return reply(m, "Rôle automatique désactivé.");
});
command(["addrole", "removerole"], async (m, _args, name) => {
  if (!requirePermission(m, FLAGS.ManageRoles)) return;
  const member = m.mentions.members.first();
  const role = m.mentions.roles.first();
  if (!member || !role) return reply(m, "Mentionne un membre et un rôle.");
  if (role.managed || role.position >= m.guild.members.me.roles.highest.position) return reply(m, "Je ne peux pas modifier ce rôle : il est géré ou supérieur au mien.");
  const adding = name === "addrole";
  if (adding && member.roles.cache.has(role.id)) return reply(m, `${member} possède déjà ce rôle.`);
  if (!adding && !member.roles.cache.has(role.id)) return reply(m, `${member} ne possède pas ce rôle.`);
  await member.roles[adding ? "add" : "remove"](role, `Commande par ${m.author.tag}`);
  return reply(m, `Rôle ${adding ? "ajouté à" : "retiré à"} ${member}.`);
});
command(["clear"], async (m, args) => {
  if (!requirePermission(m, FLAGS.ManageMessages)) return;
  const count = parseCount(args.trim().split(/\s+/)[0], null, 1, 99);
  if (!count) return reply(m, "Indique un nombre compris entre 1 et 99.");
  const deleted = await m.channel.bulkDelete(count + 1, true);
  const notice = await m.channel.send(`🧹 ${Math.max(0, deleted.size - 1)} message(s) supprimé(s).`);
  setTimeout(() => notice.delete().catch(() => {}), 4000).unref?.();
});
command(["kick"], async (m, args) => {
  if (!requirePermission(m, FLAGS.KickMembers)) return;
  const member = m.mentions.members.first();
  if (!member) return reply(m, "Mentionne un membre à expulser.");
  const reason = clean(args.replace(/<@!?\d+>/, "").trim() || "Aucune raison", 400);
  await member.kick(reason);
  return reply(m, `${member.user.tag} a été expulsé. Raison : ${reason}`);
});
command(["ban"], async (m, args) => {
  if (!requirePermission(m, FLAGS.BanMembers)) return;
  const member = m.mentions.members.first();
  if (!member) return reply(m, "Mentionne un membre à bannir.");
  const reason = clean(args.replace(/<@!?\d+>/, "").trim() || "Aucune raison", 400);
  await member.ban({ reason });
  return reply(m, `${member.user.tag} a été banni. Raison : ${reason}`);
});
command(["unban"], async (m, args) => {
  if (!requirePermission(m, FLAGS.BanMembers)) return;
  const id = args.trim().split(/\s+/)[0];
  if (!/^\d{17,20}$/.test(id || "")) return reply(m, "Indique un identifiant Discord valide.");
  const user = await client.users.fetch(id).catch(() => null);
  if (!user) return reply(m, "Utilisateur introuvable.");
  await m.guild.members.unban(user);
  return reply(m, `${user.tag} a été débanni.`);
});
command(["mute"], async (m, args) => {
  if (!requirePermission(m, FLAGS.ModerateMembers)) return;
  const member = m.mentions.members.first();
  if (!member) return reply(m, "Mentionne un membre à mettre en sourdine.");
  const afterMention = args.replace(/<@!?\d+>/, "").trim();
  const minutes = afterMention ? parseCount(afterMention, null, 1, 40_320) : 10;
  if (!minutes) return reply(m, "Durée invalide. Choisis entre 1 minute et 28 jours.");
  await member.timeout(minutes * 60_000, `Commande par ${m.author.tag}`);
  return reply(m, `${member} est en sourdine pendant ${minutes} minute(s).`);
});
command(["unmute"], async m => {
  if (!requirePermission(m, FLAGS.ModerateMembers)) return;
  const member = m.mentions.members.first();
  if (!member) return reply(m, "Mentionne un membre.");
  await member.timeout(null, `Commande par ${m.author.tag}`);
  return reply(m, `La sourdine de ${member} est retirée.`);
});
command(["warn"], async (m, args) => {
  if (!requirePermission(m, FLAGS.ManageMessages)) return;
  const member = m.mentions.members.first();
  if (!member) return reply(m, "Mentionne un membre.");
  const reason = clean(args.replace(/<@!?\d+>/, "").trim() || "Aucune raison", 400);
  const key = scoped(m.guild.id, member.id);
  db.warns[key] ||= [];
  const id = Math.max(0, ...db.warns[key].map(item => item.id || 0)) + 1;
  db.warns[key].push({ id, reason, by: m.author.id, date: new Date().toISOString() });
  save("warns");
  return reply(m, `${member} a reçu un avertissement (ID ${id}). Raison : ${reason}`);
});
command(["unwarn"], async (m, args) => {
  if (!requirePermission(m, FLAGS.ManageMessages)) return;
  const member = m.mentions.members.first();
  if (!member) return reply(m, "Mentionne un membre.");
  const id = Number.parseInt(args.replace(/<@!?\d+>/, "").trim(), 10);
  const key = scoped(m.guild.id, member.id);
  const rows = db.warns[key] || [];
  if (!Number.isInteger(id) || !rows.some(warn => warn.id === id)) return reply(m, "Identifiant d’avertissement introuvable.");
  db.warns[key] = rows.filter(warn => warn.id !== id); save("warns");
  return reply(m, `Avertissement ${id} retiré à ${member}.`);
});
command(["warns"], async m => {
  const member = m.mentions.members.first();
  if (!member) return reply(m, "Mentionne un membre.");
  const rows = db.warns[scoped(m.guild.id, member.id)] || [];
  if (!rows.length) return reply(m, `${member} n’a aucun avertissement.`);
  const lines = rows.slice(-20).map(w => `**#${w.id}** — ${clean(w.reason, 250)} (par <@${w.by}>, ${w.date.slice(0, 10)})`);
  return m.reply({ embeds: [embed(`Avertissements de ${clean(member.user.tag)}`, lines.join("\n"), 0xffa500)] });
});
command(["clearwarns"], async m => {
  if (!requireAdmin(m)) return;
  const member = m.mentions.members.first();
  if (!member) return reply(m, "Mentionne un membre.");
  delete db.warns[scoped(m.guild.id, member.id)]; save("warns");
  return reply(m, `Les avertissements de ${member} ont été supprimés.`);
});
command(["lock"], async m => {
  if (!requirePermission(m, FLAGS.ManageChannels)) return;
  await m.channel.permissionOverwrites.edit(m.guild.roles.everyone, { SendMessages: false });
  return reply(m, "Salon verrouillé.");
});
command(["unlock"], async m => {
  if (!requirePermission(m, FLAGS.ManageChannels)) return;
  await m.channel.permissionOverwrites.edit(m.guild.roles.everyone, { SendMessages: true });
  return reply(m, "Salon déverrouillé.");
});
command(["slowmode"], async (m, args) => {
  if (!requirePermission(m, FLAGS.ManageChannels)) return;
  const seconds = parseCount(args.trim(), null, 0, 21_600);
  if (seconds === null) return reply(m, "Indique un délai entre 0 et 21600 secondes.");
  await m.channel.setRateLimitPerUser(seconds);
  return reply(m, `Mode lent réglé à ${seconds} seconde(s).`);
});
command(["hide"], async m => {
  if (!requirePermission(m, FLAGS.ManageChannels)) return;
  await m.channel.permissionOverwrites.edit(m.guild.roles.everyone, { ViewChannel: false });
  return reply(m, "Salon masqué pour @everyone.");
});
command(["show"], async m => {
  if (!requirePermission(m, FLAGS.ManageChannels)) return;
  await m.channel.permissionOverwrites.edit(m.guild.roles.everyone, { ViewChannel: true });
  return reply(m, "Salon visible pour @everyone.");
});
command(["nuke"], async m => {
  if (!requireAdmin(m)) return;
  const old = m.channel;
  const replacement = await old.clone({ reason: `Recréé à la demande de ${m.author.tag}` });
  await old.delete("Salon recréé par un administrateur");
  return replacement.send("Salon recréé.");
});
command(["serverinfo"], async m => {
  const guild = m.guild;
  const card = embed(guild.name, [
    `Propriétaire : <@${guild.ownerId}>`,
    `Membres : ${guild.memberCount}`,
    `Salons : ${guild.channels.cache.size}`,
    `Rôles : ${guild.roles.cache.size}`,
    `Créé le : ${guild.createdAt.toLocaleDateString("fr-FR")}`,
  ].join("\n"), 0x3578e5);
  if (guild.iconURL()) card.setThumbnail(guild.iconURL());
  return m.reply({ embeds: [card] });
});
command(["userinfo"], async m => {
  const member = m.mentions.members.first() || m.member;
  const roles = member.roles.cache.filter(role => role.id !== m.guild.id).map(role => role.toString()).slice(0, 20);
  const card = embed(member.user.tag, [
    `ID : ${member.id}`, `Bot : ${member.user.bot ? "Oui" : "Non"}`,
    `Compte créé : ${member.user.createdAt.toLocaleDateString("fr-FR")}`,
    `Arrivée : ${member.joinedAt?.toLocaleDateString("fr-FR") || "inconnue"}`,
    `Rôles : ${roles.join(", ") || "Aucun"}`,
  ].join("\n"), member.displayColor || 0x00bfff).setThumbnail(member.displayAvatarURL());
  return m.reply({ embeds: [card] });
});
command(["botinfo"], async m => reply(m, `Bot en ligne · ${client.guilds.cache.size} serveur(s) · ${Math.round(client.ws.ping)} ms · préfixe \`${PREFIX}\`.`));
command(["ping"], async m => reply(m, `Pong ! ${Math.round(client.ws.ping)} ms`));
command(["gstart"], async (m, args) => {
  if (!requireAdmin(m)) return;
  const tokens = args.trim().split(/\s+/);
  if (tokens.length < 3) return reply(m, "Usage : `+gstart <durée> <nombre-gagnants> <prix>`.");
  const [duration, rawWinners, ...prize] = tokens;
  try {
    const giveaway = await createGiveaway(m.channel, m.author.id, prize.join(" "), duration, Number(rawWinners));
    return reply(m, `Giveaway lancé. ID : \`${giveaway.id}\`.`);
  } catch (error) { return reply(m, error.message); }
});
command(["gend"], async (m, args) => {
  if (!requireAdmin(m)) return;
  const id = args.trim();
  const giveaway = db.giveaways[`${m.guild.id}:${id}`];
  if (!giveaway || giveaway.ended) return reply(m, "Giveaway introuvable ou déjà terminé.");
  await endGiveaway(giveaway);
  return reply(m, "Giveaway terminé.");
});
command(["greroll"], async (m, args) => {
  if (!requireAdmin(m)) return;
  const id = args.trim();
  const giveaway = db.giveaways[`${m.guild.id}:${id}`];
  if (!giveaway?.ended || !giveaway.participants.length) return reply(m, "Giveaway terminé introuvable ou sans participants.");
  const pool = giveaway.participants.filter(uid => !(giveaway.winnerIds || []).includes(uid));
  const winner = pool[Math.floor(Math.random() * pool.length)];
  if (!winner) return reply(m, "Aucun autre participant disponible.");
  giveaway.winnerIds ||= [];
  giveaway.winnerIds.push(winner); save("giveaways");
  return reply(m, `Nouveau tirage : <@${winner}> gagne **${clean(giveaway.prize, 200)}** !`);
});
command(["gpanel"], async m => {
  if (!requireAdmin(m)) return;
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder()
    .setCustomId("gw:create").setLabel("Créer un giveaway").setStyle(ButtonStyle.Success));
  return m.reply({ embeds: [embed("Panneau Giveaway", "Utilise le bouton pour créer un giveaway.", 0xffd700)], components: [row] });
});
command(["rank"], async m => {
  const member = m.mentions.members.first() || m.member;
  const data = getRank(m.guild.id, member.id);
  const needed = xpForLevel(data.level);
  const filled = Math.min(20, Math.floor(data.xp / needed * 20));
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  save("ranks");
  return m.reply({ embeds: [embed(`Rang de ${clean(member.displayName)}`, `Niveau **${data.level}** · ${data.xp}/${needed} XP\nMessages : ${data.messages}\n\`${bar}\``, 0x8a2be2)] });
});
command(["leaderboard", "lb"], async m => {
  const rows = Object.entries(db.ranks).filter(([key]) => key.startsWith(`${m.guild.id}:`))
    .sort((a, b) => b[1].level - a[1].level || b[1].xp - a[1].xp).slice(0, 10);
  const lines = rows.map(([key, data], index) => {
    const userId = key.split(":")[1];
    const member = m.guild.members.cache.get(userId);
    return `**${index + 1}.** ${clean(member?.displayName || `Utilisateur ${userId}`, 60)} — niveau ${data.level} (${data.xp} XP)`;
  });
  return m.reply({ embeds: [embed("Classement du serveur", lines.join("\n") || "Aucun joueur classé.", 0xffd700)] });
});
command(["setlevel"], async (m, args) => {
  if (!requireAdmin(m)) return;
  const member = m.mentions.members.first();
  const level = Number.parseInt(args.replace(/<@!?\d+>/, "").trim(), 10);
  if (!member || !Number.isInteger(level) || level < 1 || level > 10_000) return reply(m, "Usage : `+setlevel @membre <niveau>` (1 à 10000).");
  db.ranks[scoped(m.guild.id, member.id)] = { ...getRank(m.guild.id, member.id), xp: 0, level };
  save("ranks");
  return reply(m, `Niveau de ${member} défini à ${level}.`);
});
command(["resetrank"], async m => {
  if (!requireAdmin(m)) return;
  const member = m.mentions.members.first();
  if (!member) return reply(m, "Mentionne un membre.");
  delete db.ranks[scoped(m.guild.id, member.id)]; save("ranks");
  return reply(m, `Niveau de ${member} réinitialisé.`);
});

async function clearLegacySlashCommands(discordClient) {
  await discordClient.application.commands.set([]);
  for (const guild of discordClient.guilds.cache.values()) await guild.commands.set([]);
}

client.once("ready", async () => {
  console.log(`Bot connecté : ${client.user.tag} · ${client.guilds.cache.size} serveur(s).`);
  try {
    await clearLegacySlashCommands(client);
    console.log("Anciennes commandes slash globales et par serveur supprimées.");
  } catch (error) {
    console.error("Impossible de synchroniser la suppression des commandes slash :", error.message);
    await client.destroy();
    process.exitCode = 1;
    return;
  }
  for (const giveaway of Object.values(db.giveaways)) {
    if (!giveaway.ended && giveaway.endTime <= Date.now()) void endGiveaway(giveaway);
  }
});

client.on("guildCreate", async guild => {
  try { await guild.commands.set([]); }
  catch (error) { console.error(`Suppression des commandes slash sur ${guild.id} :`, error.message); }
});

client.on("guildMemberAdd", async member => {
  const roleId = db.autorole[member.guild.id];
  const role = roleId && member.guild.roles.cache.get(roleId);
  if (role && !role.managed && role.position < member.guild.members.me.roles.highest.position) {
    await member.roles.add(role, "Rôle automatique").catch(error => console.error("Auto-role :", error.message));
  }
});

client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot || message.webhookId) return;
  try {
    if (message.content.startsWith(PREFIX)) {
      const [rawName, args] = commandArgs(message.content.slice(PREFIX.length).trim());
      const name = rawName.toLowerCase();
      const handler = commands.get(name);
      if (handler) await handler(message, args, name);
      return;
    }
    const key = scoped(message.guild.id, message.author.id);
    const now = Date.now();
    if (now - (cooldowns.get(key) || 0) < 60_000) return;
    cooldowns.set(key, now);
    const data = getRank(message.guild.id, message.author.id);
    data.xp += 15 + Math.floor(Math.random() * 11);
    data.messages++;
    let leveledUp = false;
    while (data.xp >= xpForLevel(data.level)) {
      data.xp -= xpForLevel(data.level++);
      leveledUp = true;
    }
    save("ranks");
    if (leveledUp) await message.channel.send(`${message.author} passe au **niveau ${data.level}** !`);
  } catch (error) {
    console.error(`Erreur pour ${message.guild.id} dans ${message.channelId}:`, error);
    if (message.channel.isSendable()) await message.reply("La commande a échoué. Vérifie mes permissions.").catch(() => {});
  }
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isStringSelectMenu()) {
      const page = HELP[interaction.values[0]];
      if (!page || !["help_select", "main_menu"].includes(interaction.customId)) return;
      await interaction.update({ embeds: [helpEmbed(interaction.values[0])], components: [selectRow(interaction.customId)] });
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("gw:join:")) {
      const id = interaction.customId.slice("gw:join:".length);
      const giveaway = db.giveaways[`${interaction.guildId}:${id}`];
      if (!giveaway || giveaway.ended) return interaction.reply({ content: "Ce giveaway est terminé.", ephemeral: true });
      if (giveaway.endTime <= Date.now()) {
        void endGiveaway(giveaway);
        return interaction.reply({ content: "La période de participation est terminée.", ephemeral: true });
      }
      if (giveaway.participants.includes(interaction.user.id)) return interaction.reply({ content: "Tu participes déjà !", ephemeral: true });
      giveaway.participants.push(interaction.user.id); save("giveaways");
      return interaction.reply({ content: "Participation enregistrée !", ephemeral: true });
    }
    if (interaction.isButton() && interaction.customId === "gw:create") {
      if (!interaction.memberPermissions.has(FLAGS.Administrator)) return interaction.reply({ content: "Action réservée aux administrateurs.", ephemeral: true });
      const modal = new ModalBuilder().setCustomId("gw:create-modal").setTitle("Créer un giveaway").addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("duration").setLabel("Durée (ex. 10m, 2h, 1d)").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("winners").setLabel("Nombre de gagnants (1–20)").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("prize").setLabel("Prix").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200)),
      );
      await interaction.showModal(modal);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId === "gw:create-modal") {
      if (!interaction.memberPermissions.has(FLAGS.Administrator)) return interaction.reply({ content: "Action réservée aux administrateurs.", ephemeral: true });
      try {
        const giveaway = await createGiveaway(
          interaction.channel, interaction.user.id,
          interaction.fields.getTextInputValue("prize"),
          interaction.fields.getTextInputValue("duration"),
          Number(interaction.fields.getTextInputValue("winners")),
        );
        return interaction.reply({ content: `Giveaway créé. ID : \`${giveaway.id}\`.`, ephemeral: true });
      } catch (error) { return interaction.reply({ content: error.message, ephemeral: true }); }
    }
  } catch (error) {
    console.error("Erreur d’interaction Discord :", error);
    if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: "Cette action a échoué.", ephemeral: true }).catch(() => {});
  }
});

setInterval(() => {
  for (const giveaway of Object.values(db.giveaways)) {
    if (!giveaway.ended && giveaway.endTime <= Date.now()) void endGiveaway(giveaway).catch(error => console.error("Fin du giveaway :", error));
  }
}, 30_000).unref();

async function start() {
  if (!TOKEN) throw new Error("Configure DISCORD_TOKEN dans les variables d’environnement de l’hébergeur.");
  prepareDataDirectory(DATA_DIR, DATA_FILES);
  db = Object.fromEntries(Object.entries(DATA_FILES).map(([key, file]) => [key, loadJson(DATA_DIR, file)]));
  await client.login(TOKEN);
}

if (require.main === module) {
  start().catch(error => {
    console.error("Démarrage impossible :", error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  client,
  commands,
  clearLegacySlashCommands,
  help: HELP,
  parseCount,
  parseDuration,
  prepareDataDirectory,
  xpForLevel,
};
