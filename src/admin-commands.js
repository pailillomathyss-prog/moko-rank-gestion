import { EmbedBuilder, PermissionFlagsBits } from "discord.js";

const DEFAULT_REASON = "Aucune raison précisée";

function usageReply(message, content) {
  return message.reply(content);
}

function parseTimeoutDuration(value) {
  const match = /^([1-9]\d*)(s|m|h|d)$/i.exec(value ?? "");
  if (!match) return null;
  const units = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const milliseconds = Number(match[1]) * units[match[2].toLowerCase()];
  return Number.isSafeInteger(milliseconds) &&
    milliseconds >= 10_000 &&
    milliseconds <= 28 * 86_400_000
    ? milliseconds
    : null;
}

export class AdminCommands {
  constructor({ client, database, ownerId, onGlobalBlacklist = async () => {} }) {
    this.client = client;
    this.database = database;
    this.ownerId = ownerId;
    this.onGlobalBlacklist = onGlobalBlacklist;
  }

  async resolveMember(message, input) {
    const mentioned = message.mentions.members.first();
    if (mentioned) return mentioned;
    if (!input) return null;
    return message.guild.members.fetch(input.replace(/[<@!>]/g, "")).catch(() => null);
  }

  async handle(message, command, args) {
    if (command === "gbl") return this.handleGlobalBlacklist(message, args);
    if (command === "owner") return this.handleOwner(message, args);
    if (command === "staff") return this.handleStaff(message, args);
    if (["kick", "ban", "unban", "timeout", "untimeout", "clear", "warn", "warnings", "clearwarnings"].includes(command)) {
      return this.handleModeration(message, command, args);
    }
    return false;
  }

  async handleModeration(message, command, args) {
    const guild = message.guild;
    const actor = message.member;
    const permission =
      command === "clear" || command === "warn" || command === "warnings" || command === "clearwarnings"
        ? PermissionFlagsBits.ManageMessages
        : command === "unban" || command === "ban"
          ? PermissionFlagsBits.BanMembers
          : command === "timeout" || command === "untimeout"
            ? PermissionFlagsBits.ModerateMembers
          : PermissionFlagsBits.KickMembers;
    if (!actor?.permissions.has(permission)) {
      await usageReply(message, "Tu n’as pas la permission nécessaire pour cette commande.");
      return true;
    }

    if (command === "clear") {
      const amount = Number(args[0]);
      if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
        await usageReply(message, "Utilise `+clear <1 à 100>`.");
        return true;
      }
      if (typeof message.channel.bulkDelete !== "function") {
        await usageReply(message, "Cette commande fonctionne uniquement dans un salon textuel.");
        return true;
      }
      const deleted = await message.channel.bulkDelete(amount, true);
      await message.channel.send(`🧹 ${deleted.size} message(s) supprimé(s).`);
      return true;
    }

    if (command === "unban") {
      const userId = args[0]?.replace(/[<@!>]/g, "");
      if (!/^\d{15,22}$/.test(userId ?? "")) {
        await usageReply(message, "Utilise `+unban <ID Discord> [raison]`.");
        return true;
      }
      await guild.members.unban(userId, args.slice(1).join(" ") || DEFAULT_REASON);
      await usageReply(message, `✅ Le bannissement de \`${userId}\` a été levé.`);
      return true;
    }

    const member = await this.resolveMember(message, args[0]);
    if (!member) {
      await usageReply(message, `Mentionne un membre. Utilise \`+${command} @membre [raison]\`.`);
      return true;
    }
    if (member.id === message.author.id) {
      await usageReply(message, "Tu ne peux pas utiliser cette commande sur toi-même.");
      return true;
    }
    if (member.roles.highest.position >= actor.roles.highest.position && guild.ownerId !== actor.id) {
      await usageReply(message, "Tu ne peux pas modérer un membre ayant un rôle égal ou supérieur au tien.");
      return true;
    }

    if (command === "kick") {
      await member.kick(args.slice(1).join(" ") || DEFAULT_REASON);
      await usageReply(message, `👢 ${member.user.tag} a été expulsé.`);
      return true;
    }

    if (command === "ban") {
      await guild.members.ban(member.id, {
        reason: args.slice(1).join(" ") || DEFAULT_REASON,
      });
      await usageReply(message, `🔨 ${member.user.tag} a été banni du serveur.`);
      return true;
    }

    if (command === "timeout" || command === "untimeout") {
      const duration = command === "timeout" ? parseTimeoutDuration(args[1]) : null;
      if (command === "timeout" && !duration) {
        await usageReply(message, "Utilise `+timeout @membre <10s à 28d> [raison]`.");
        return true;
      }
      const reason = args.slice(command === "timeout" ? 2 : 1).join(" ") || DEFAULT_REASON;
      await member.timeout(duration, reason);
      await usageReply(
        message,
        command === "timeout"
          ? `⏳ ${member.user.tag} est en timeout pour ${args[1]}.`
          : `✅ Le timeout de ${member.user.tag} a été retiré.`
      );
      return true;
    }

    if (command === "warn") {
      const reason =
        args.slice(1).join(" ").slice(0, 500) || DEFAULT_REASON;
      const warningId = this.database.addWarning(
        guild.id,
        member.id,
        message.author.id,
        reason
      );
      await usageReply(message, `⚠️ ${member.user.tag} a reçu un avertissement (#${warningId}).`);
      return true;
    }

    if (command === "warnings" || command === "clearwarnings") {
      if (command === "clearwarnings") {
        const count = this.database.clearWarnings(guild.id, member.id);
        await usageReply(message, `🧾 ${count} avertissement(s) supprimé(s) pour ${member.user.tag}.`);
        return true;
      }
      const warnings = this.database.getWarnings(guild.id, member.id);
      const embed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle(`Avertissements · ${member.user.tag}`)
        .setDescription(
          warnings.length
            ? warnings.map((warning) => `**#${warning.id}** — ${warning.reason} (<@${warning.moderator_id}>)`).join("\n")
            : "Aucun avertissement enregistré."
        );
      await message.reply({ embeds: [embed] });
      return true;
    }

    return false;
  }

  async handleStaff(message, args) {
    const actor = message.member;
    if (!actor?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await usageReply(message, "Il te faut la permission **Gérer les rôles**.");
      return true;
    }

    const action = args[0]?.toLowerCase();
    if (action === "role") {
      const role = message.mentions.roles.first();
      if (!role || role.id === message.guild.id || role.managed) {
        await usageReply(message, "Utilise `+staff role @rôle` avec un rôle attribuable.");
        return true;
      }
      const botMember = message.guild.members.me;
      if (!botMember || role.position >= botMember.roles.highest.position) {
        await usageReply(message, "Place le rôle du bot au-dessus du rôle staff.");
        return true;
      }
      this.database.ensureGuild(message.guild.id);
      this.database.setStaffRole(message.guild.id, role.id);
      await usageReply(message, `✅ Le rôle staff est maintenant ${role}.`);
      return true;
    }

    const settings = this.database.ensureGuild(message.guild.id);
    const role = settings.staffRoleId
      ? message.guild.roles.cache.get(settings.staffRoleId)
      : null;
    if (!role) {
      await usageReply(message, "Configure d’abord le rôle avec `+staff role @rôle`.");
      return true;
    }
    if (action === "list") {
      const members = [...message.guild.members.cache.values()]
        .filter((member) => member.roles.cache.has(role.id))
        .slice(0, 30);
      await usageReply(
        message,
        members.length
          ? `**Staff (${members.length})**\n${members.map((member) => `• ${member.user.tag}`).join("\n")}`
          : "Aucun membre staff trouvé dans le cache du serveur."
      );
      return true;
    }

    const member = await this.resolveMember(message, args[1]);
    if (!member || !["add", "remove"].includes(action)) {
      await usageReply(message, "Utilise `+staff add @membre`, `+staff remove @membre` ou `+staff list`.");
      return true;
    }
    if (action === "add") {
      await member.roles.add(role, `Ajout au staff par ${message.author.tag}.`);
      await usageReply(message, `✅ ${member.user.tag} a rejoint le staff.`);
    } else {
      await member.roles.remove(role, `Retrait du staff par ${message.author.tag}.`);
      await usageReply(message, `✅ ${member.user.tag} a quitté le staff.`);
    }
    return true;
  }

  isOwner(message) {
    return Boolean(this.ownerId && message.author.id === this.ownerId);
  }

  async handleOwner(message, args) {
    if (!this.ownerId) {
      await usageReply(message, "Configure BOT_OWNER_ID dans les variables d’environnement du bot.");
      return true;
    }
    if (!this.isOwner(message)) {
      await usageReply(message, "Cette commande est réservée au propriétaire du bot.");
      return true;
    }
    const action = args[0]?.toLowerCase();
    if (action === "guilds") {
      const guilds = [...this.client.guilds.cache.values()];
      await message.reply(
        guilds.length
          ? `**Serveurs (${guilds.length})**\n${guilds.slice(0, 30).map((guild) => `• ${guild.name} — \`${guild.id}\``).join("\n")}`
          : "Le bot n’est présent sur aucun serveur."
      );
      return true;
    }
    if (action === "stats") {
      const guilds = [...this.client.guilds.cache.values()];
      await message.reply(
        `**État du bot**\n• Serveurs : ${guilds.length}\n• Membres visibles : ${guilds.reduce((total, guild) => total + guild.memberCount, 0)}\n• BL globale : ${this.database.getGlobalBlacklist().length}`
      );
      return true;
    }
    await usageReply(message, "Utilise `+owner stats` ou `+owner guilds`.");
    return true;
  }

  async handleGlobalBlacklist(message, args) {
    if (!this.ownerId) {
      await usageReply(message, "Configure BOT_OWNER_ID dans les variables d’environnement du bot.");
      return true;
    }
    if (!this.isOwner(message)) {
      await usageReply(message, "La BL globale est réservée au propriétaire du bot.");
      return true;
    }
    const [action, rawId, confirmation, ...reasonParts] = args;
    if (action === "ban") {
      const userId = rawId?.replace(/[<@!>]/g, "");
      if (!/^\d{15,22}$/.test(userId ?? "")) {
        await usageReply(message, "Utilise `+gbl ban <ID> confirmer [raison]`.");
        return true;
      }
      if (confirmation?.toLowerCase() !== "confirmer") {
        await usageReply(
          message,
          "Cette action bannira cet ID dans tous les serveurs où le bot le peut. Pour continuer, retape `+gbl ban <ID> confirmer [raison]`."
        );
        return true;
      }
      const reason = reasonParts.join(" ").slice(0, 400) || DEFAULT_REASON;
      this.database.addGlobalBlacklist(userId, reason, message.author.id);
      await this.onGlobalBlacklist(userId);
      let banned = 0;
      const failures = [];
      for (const guild of this.client.guilds.cache.values()) {
        try {
          await guild.members.ban(userId, { reason: `BL globale: ${reason}` });
          banned += 1;
        } catch {
          failures.push(guild.name);
        }
      }
      await usageReply(
        message,
        `🚫 \`${userId}\` ajouté à la BL globale. Banni dans ${banned} serveur(s); échec ou permission manquante dans ${failures.length}. Les commandes du bot lui sont bloquées partout.`
      );
      return true;
    }
    if (action === "remove" || action === "retirer") {
      const userId = rawId?.replace(/[<@!>]/g, "");
      if (!/^\d{15,22}$/.test(userId ?? "")) {
        await usageReply(message, "Utilise `+gbl remove <ID>`.");
        return true;
      }
      const removed = this.database.removeGlobalBlacklist(userId);
      await usageReply(
        message,
        removed
          ? `✅ \`${userId}\` retiré de la BL. Les bans des serveurs doivent être levés séparément avec \`+unban\`.`
          : "Cet ID n’est pas dans la BL globale."
      );
      return true;
    }
    if (action === "list") {
      const entries = this.database.getGlobalBlacklist();
      await message.reply(
        entries.length
          ? `**BL globale (${entries.length})**\n${entries.slice(0, 30).map((entry) => `• \`${entry.user_id}\` — ${entry.reason}`).join("\n")}`
          : "La BL globale est vide."
      );
      return true;
    }
    await usageReply(
      message,
      "Utilise `+gbl ban <ID> confirmer [raison]`, `+gbl remove <ID>` ou `+gbl list`."
    );
    return true;
  }
}
