import { PermissionFlagsBits } from "discord.js";

const USER_ID_PATTERN = /^\d{15,22}$/;
const JAILED_CHANNEL_PERMISSIONS = {
  ViewChannel: false,
  SendMessages: false,
  SendMessagesInThreads: false,
  AddReactions: false,
  Connect: false,
  Speak: false,
  CreatePublicThreads: false,
  CreatePrivateThreads: false,
  UseApplicationCommands: false,
};

export class SecurityManager {
  constructor({ database, ownerId }) {
    this.database = database;
    this.ownerId = ownerId;
    this.joinWindows = new Map();
  }

  canUseBrigade(member, settings) {
    return Boolean(
      member?.permissions.has(PermissionFlagsBits.ManageGuild) ||
        (settings.brigadeRoleId &&
          member?.roles.cache.has(settings.brigadeRoleId))
    );
  }

  async applyJailOverwrites(guild, jailRole, jailChannel) {
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      throw new Error("Le bot doit avoir la permission Gérer les rôles.");
    }
    if (jailRole.position >= guild.members.me.roles.highest.position) {
      throw new Error("Le rôle du bot doit être au-dessus du rôle de jail.");
    }

    for (const channel of guild.channels.cache.values()) {
      if (!channel.permissionOverwrites?.edit) continue;
      const permissions =
        channel.id === jailChannel.id
          ? {
              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory: true,
              Connect: false,
              Speak: false,
            }
          : JAILED_CHANNEL_PERMISSIONS;
      await channel.permissionOverwrites.edit(jailRole, permissions, {
        reason: "Configuration du système de jail Moko Rank.",
      });
    }
  }

  async jailMember(member, reason, actorId = "system") {
    if (
      member.id === member.guild.ownerId ||
      member.permissions?.has(PermissionFlagsBits.Administrator)
    ) {
      return false;
    }
    const settings = this.database.ensureGuild(member.guild.id);
    const role = settings.jailRoleId
      ? member.guild.roles.cache.get(settings.jailRoleId)
      : null;
    if (!role || !settings.jailChannelId) return false;
    if (!member.roles.cache.has(role.id)) {
      await member.roles.add(role, `Jail: ${reason}`);
    }
    this.database.setJailedMember(
      member.guild.id,
      member.id,
      reason.slice(0, 400),
      actorId
    );
    return true;
  }

  async releaseMember(member) {
    const settings = this.database.ensureGuild(member.guild.id);
    if (settings.jailRoleId && member.roles.cache.has(settings.jailRoleId)) {
      await member.roles.remove(
        settings.jailRoleId,
        "Fin du jail par la brigade."
      );
    }
    return this.database.removeJailedMember(member.guild.id, member.id);
  }

  async onMemberJoin(member) {
    if (this.database.isGloballyBlacklisted(member.id)) return;
    const settings = this.database.ensureGuild(member.guild.id);
    const existingJail = this.database.getJailedMember(
      member.guild.id,
      member.id
    );
    if (existingJail) {
      await this.jailMember(member, existingJail.reason, existingJail.jailed_by);
      return;
    }
    if (this.database.isEnemyMember(member.guild.id, member.id)) {
      await this.jailMember(
        member,
        "ID ajouté manuellement à la liste des membres ennemis."
      );
    }

    if (!settings.antiRaidEnabled || !settings.jailRoleId || !settings.jailChannelId) {
      return;
    }
    const now = Date.now();
    const windowMs = settings.raidWindowSeconds * 1_000;
    const active = (this.joinWindows.get(member.guild.id) ?? []).filter(
      (join) => now - join.joinedAt <= windowMs
    );
    active.push({ joinedAt: now, member });
    this.joinWindows.set(member.guild.id, active);

    if (active.length < settings.raidThreshold) return;
    this.joinWindows.set(member.guild.id, []);
    for (const join of active) {
      if (this.database.getJailedMember(member.guild.id, join.member.id)) continue;
      await this.jailMember(
        join.member,
        `Anti-raid : ${active.length} arrivées en ${settings.raidWindowSeconds} secondes.`
      );
    }
  }

  async onChannelCreate(channel) {
    const settings = this.database.ensureGuild(channel.guild.id);
    const jailRole = settings.jailRoleId
      ? channel.guild.roles.cache.get(settings.jailRoleId)
      : null;
    if (!jailRole || !settings.jailChannelId || !channel.permissionOverwrites?.edit) {
      return;
    }
    const permissions =
      channel.id === settings.jailChannelId
        ? {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            Connect: false,
            Speak: false,
          }
        : JAILED_CHANNEL_PERMISSIONS;
    await channel.permissionOverwrites.edit(jailRole, permissions, {
      reason: "Application des permissions du jail Moko Rank.",
    });
  }

  async handleCommand(message, command, args) {
    if (!["brigade", "jail", "unjail", "enemy", "security"].includes(command)) {
      return false;
    }
    const guild = message.guild;
    const settings = this.database.ensureGuild(guild.id);
    const action = args[0]?.toLowerCase();
    const manageGuild = message.member?.permissions.has(
      PermissionFlagsBits.ManageGuild
    );

    if (command === "brigade") {
      if (!manageGuild) {
        await message.reply("Seuls les responsables du serveur peuvent configurer la brigade.");
        return true;
      }
      if (action === "role") {
        const role = message.mentions.roles.first();
        if (
          !role ||
          role.id === guild.id ||
          role.managed ||
          role.permissions.has(PermissionFlagsBits.Administrator)
        ) {
          await message.reply("Utilise `+brigade role @rôle` avec un rôle dédié.");
          return true;
        }
        this.database.setBrigadeRole(guild.id, role.id);
        await message.reply(`✅ La brigade de sécurité est ${role}. Ses membres peuvent utiliser les commandes de sécurité.`);
        return true;
      }
      if (action === "jailrole") {
        const role = message.mentions.roles.first();
        const channel = message.mentions.channels.first();
        if (!role || !channel || !channel.isTextBased?.()) {
          await message.reply("Utilise `+brigade jailrole @rôle #salon-jail`.");
          return true;
        }
        try {
          await this.applyJailOverwrites(guild, role, channel);
          this.database.setJailConfig(guild.id, role.id, channel.id);
          await message.reply(`✅ Le rôle ${role} et le salon ${channel} sont configurés. Les membres jailés ne verront que ce salon.`);
        } catch (error) {
          await message.reply(`Configuration impossible : ${error.message}`);
        }
        return true;
      }
      if (action === "raid") {
        const enabled = args[1]?.toLowerCase() === "on";
        if (!["on", "off"].includes(args[1]?.toLowerCase())) {
          await message.reply("Utilise `+brigade raid on` ou `+brigade raid off`.");
          return true;
        }
        if (enabled && (!settings.jailRoleId || !settings.jailChannelId)) {
          await message.reply("Configure d’abord le jail avec `+brigade jailrole @rôle #salon-jail`.");
          return true;
        }
        this.database.setRaidSettings(
          guild.id,
          enabled,
          settings.raidThreshold,
          settings.raidWindowSeconds
        );
        await message.reply(enabled ? "🛡️ Anti-raid activé." : "Anti-raid désactivé.");
        return true;
      }
      if (action === "seuil") {
        const threshold = Number(args[1]);
        const windowSeconds = Number(args[2]);
        if (
          !Number.isInteger(threshold) ||
          threshold < 3 ||
          threshold > 50 ||
          !Number.isInteger(windowSeconds) ||
          windowSeconds < 5 ||
          windowSeconds > 120
        ) {
          await message.reply("Utilise `+brigade seuil <3-50 arrivées> <5-120 secondes>`.");
          return true;
        }
        this.database.setRaidSettings(
          guild.id,
          settings.antiRaidEnabled,
          threshold,
          windowSeconds
        );
        await message.reply(`✅ Seuil anti-raid : ${threshold} arrivées en ${windowSeconds} secondes.`);
        return true;
      }
      await message.reply("Commandes : `+brigade role`, `+brigade jailrole`, `+brigade raid on/off`, `+brigade seuil`.");
      return true;
    }

    if (!this.canUseBrigade(message.member, settings)) {
      await message.reply("Cette commande est réservée à la brigade de sécurité.");
      return true;
    }

    if (command === "security") {
      await message.reply(
        `**Sécurité**\n• Anti-raid : ${settings.antiRaidEnabled ? "activé" : "désactivé"}\n• Seuil : ${settings.raidThreshold} arrivées / ${settings.raidWindowSeconds}s\n• Rôle brigade : ${settings.brigadeRoleId ? `<@&${settings.brigadeRoleId}>` : "non configuré"}\n• Salon jail : ${settings.jailChannelId ? `<#${settings.jailChannelId}>` : "non configuré"}`
      );
      return true;
    }

    if (command === "enemy") {
      const userId = args[1]?.replace(/[<@!>]/g, "");
      if (action === "list") {
        const enemies = this.database.getEnemyMembers(guild.id);
        await message.reply(
          enemies.length
            ? `**Liste manuelle (${enemies.length})**\n${enemies.slice(0, 30).map((entry) => `• \`${entry.user_id}\` — ${entry.reason}`).join("\n")}`
            : "La liste manuelle est vide."
        );
        return true;
      }
      if (!USER_ID_PATTERN.test(userId ?? "")) {
        await message.reply("Utilise `+enemy add <ID> [raison]`, `+enemy remove <ID>` ou `+enemy list`.");
        return true;
      }
      if (action === "add") {
        const reason = args.slice(2).join(" ").slice(0, 400) || "Ajout manuel par la brigade.";
        this.database.addEnemyMember(guild.id, userId, reason, message.author.id);
        const member = await guild.members.fetch(userId).catch(() => null);
        const jailed = member ? await this.jailMember(member, reason, message.author.id) : false;
        await message.reply(jailed
          ? `✅ \`${userId}\` ajouté à la liste et mis en jail.`
          : `✅ \`${userId}\` ajouté à la liste ; il sera jailé s’il rejoint. Configure d’abord le rôle et salon jail si besoin.`);
        return true;
      }
      if (action === "remove") {
        const removed = this.database.removeEnemyMember(guild.id, userId);
        await message.reply(removed
          ? `✅ \`${userId}\` retiré de la liste. Un membre déjà jailé doit être libéré avec \`+unjail\`.`
          : "Cet ID n’est pas dans la liste.");
        return true;
      }
      await message.reply("Utilise `+enemy add <ID> [raison]`, `+enemy remove <ID>` ou `+enemy list`.");
      return true;
    }

    const member =
      message.mentions.members.first() ??
      (args[0] ? await guild.members.fetch(args[0].replace(/[<@!>]/g, "")).catch(() => null) : null);
    if (!member) {
      await message.reply(`Utilise \`+${command} @membre [raison]\`.`);
      return true;
    }
    if (command === "jail") {
      const reason = args.slice(1).join(" ") || "Jail par la brigade.";
      const jailed = await this.jailMember(member, reason, message.author.id);
      await message.reply(jailed ? `🔒 ${member.user.tag} a été mis en jail.` : "Configure d’abord le rôle et le salon jail.");
      return true;
    }
    if (command === "unjail") {
      await this.releaseMember(member);
      await message.reply(`🔓 ${member.user.tag} a été libéré.`);
      return true;
    }
    return false;
  }
}
