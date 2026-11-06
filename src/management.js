import { ChannelType, EmbedBuilder, PermissionFlagsBits as P } from "discord.js";
import { LEVELS, memberLevel, requiredLevel, assertAccess, assertTarget, assertRole, assertBotPermission } from "./access.js";
import { ACTIONS, commandLevels } from "./management-commands.js";

const idPattern = /^\d{15,22}$/;
const triState = (overwrite, bit) => overwrite?.allow.has(bit) ? true : overwrite?.deny.has(bit) ? false : null;
export class ManagementHandler {
  constructor(store, jailDatabase) {
    this.store = store;
    this.jailDatabase = jailDatabase;
    this.busy = new Set();
  }
  async handle(i) {
    if (!i.inGuild()) return i.reply({ content: "Commande réservée aux serveurs.", ephemeral: true });
    await i.deferReply({ ephemeral: true });
    if (this.busy.has(i.guildId)) return i.editReply("Une action de gestion est en cours. Réessaie dans quelques secondes.");
    this.busy.add(i.guildId);
    let completed = false;
    try {
      const actor = await i.guild.members.fetch({ user: i.user.id, force: true });
      const config = this.store.get(i.guildId);
      if (i.commandName === "aide") return await i.editReply({ embeds: [this.help(actor, config)], allowedMentions: { parse: [] } });
      if (i.commandName === "acces") {
        const result = await this.configure(i, actor, config);
        return await i.editReply({ content: result, allowedMentions: { parse: [] } });
      }
      const group = i.options.getSubcommandGroup();
      const action = i.options.getSubcommand();
      const key = `${group}.${action}`;
      const definition = ACTIONS.find(([g, a]) => g === group && a === action);
      if (!definition) throw new Error("Commande inconnue.");
      assertAccess(actor, config, key, definition[2]);
      if (definition[4].some(([, name]) => name === "confirmer") && !i.options.getBoolean("confirmer")) {
        throw new Error("Action annulée : confirmer doit être vrai. Une suppression ne peut pas être annulée.");
      }
      const bot = await i.guild.members.fetchMe();
      const result = await this.execute(i, actor, bot, config, group, action);
      completed = true;
      const readOnly = group === "info" || ["avertissements", "historique", "bannissements"].includes(action);
      let notice = "";
      if (!readOnly) {
        try {
          if (action !== "avertir") this.store.record(i.guildId, i.options.getUser("membre")?.id ?? null, actor.id, key, i.options.getString("raison") || result);
        } catch (error) {
          console.error("Action effectuée, historique indisponible", error);
          notice += "\nAttention : action effectuée mais historique non enregistré.";
        }
        notice += await this.log(i, config, key, result);
      }
      await i.editReply({ content: `${result}${notice}`.slice(0, 1950), allowedMentions: { parse: [] } });
    } catch (error) {
      console.error("Gestion Discord", error);
      await i.editReply({ content: `${completed ? "Action effectuée, mais réponse incomplète" : "Action impossible"} : ${error.message}`.slice(0, 1950), allowedMentions: { parse: [] } });
    } finally {
      this.busy.delete(i.guildId);
    }
  }
  help(actor, config) {
    const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("Gestion — commandes par niveau")
      .setDescription(`Ton niveau : **${LEVELS[memberLevel(actor, config)]}**.\nLes niveaux supérieurs héritent des commandes inférieures. Utilise /gestion puis le groupe et l’action.`);
    for (let level = 0; level <= 4; level++) {
      const keys = Object.entries(commandLevels).filter(([key, base]) => requiredLevel(config, key, base) === level).map(([key]) => `\`${key}\``);
      embed.addFields({ name: `${level} — ${LEVELS[level]}`, value: (keys.join(", ") || "Aucune commande") + (level === 4 ? "\n`/acces` : attribution des niveaux, exigences des commandes et logs." : "") });
    }
    return embed.setFooter({ text: "Le propriétaire configure les rôles avec /acces role. Les rôles Discord seuls ne donnent pas de niveau implicite." });
  }
  async log(i, config, action, result) {
    if (!config.logChannel) return "";
    try {
      const channel = await i.guild.channels.fetch(config.logChannel);
      if (!channel?.isTextBased()) throw new Error("Salon de logs absent.");
      await channel.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(action)
        .setDescription(`${i.user.tag} (${i.user.id})\n${result}`.slice(0, 4000)).setTimestamp()], allowedMentions: { parse: [] } });
      return "";
    } catch (error) {
      console.error("Journal Discord indisponible", error);
      return "\nAttention : action effectuée, mais envoi au salon de logs impossible.";
    }
  }
  async configure(i, actor, config) {
    const action = i.options.getSubcommand();
    if (action === "voir") {
      const roles = Object.entries(config.roles).map(([id, level]) => `<@&${id}> : ${level} — ${LEVELS[level]}`);
      return `Ton niveau : ${LEVELS[memberLevel(actor, config)]}\n${roles.join("\n") || "Aucun rôle associé."}\nLogs : ${config.logChannel ? `<#${config.logChannel}>` : "désactivés"}\nNiveaux des commandes : /aide`.slice(0, 1900);
    }
    if (actor.id !== i.guild.ownerId) throw new Error("Seul le propriétaire du serveur peut modifier les accès.");
    let result;
    if (action === "role") {
      const role = await i.guild.roles.fetch(i.options.getRole("role", true).id);
      const level = i.options.getInteger("niveau", true);
      const jail = this.jailDatabase.getSettings(i.guildId);
      if (!role || role.id === i.guildId || role.managed ||
          role.id === jail.jail_role_id || jail.rank_role_ids.includes(role.id)) {
        throw new Error("Ce rôle ne peut pas recevoir de niveau de gestion.");
      }
      if (level) config.roles[role.id] = level;
      else delete config.roles[role.id];
      result = level ? `${role.name} associé au niveau ${LEVELS[level]}.` : `Association de ${role.name} retirée.`;
    } else if (action === "commande" || action === "reinitialiser-commande") {
      const key = i.options.getString("commande", true).trim();
      if (!Object.hasOwn(commandLevels, key)) throw new Error("Clé inconnue. Consulte /aide.");
      if (action === "reinitialiser-commande") delete config.commands[key];
      else {
        const level = i.options.getInteger("niveau", true);
        if (level < commandLevels[key]) throw new Error(`Niveau minimal de sécurité : ${LEVELS[commandLevels[key]]}.`);
        config.commands[key] = level;
      }
      result = `${key} : ${LEVELS[requiredLevel(config, key, commandLevels[key])]}.`;
    } else if (action === "logs") {
      const channel = await i.guild.channels.fetch(i.options.getChannel("salon", true).id);
      if (channel?.type !== ChannelType.GuildText) throw new Error("Choisis un salon textuel du serveur.");
      const bot = await i.guild.members.fetchMe();
      for (const p of ["ViewChannel", "SendMessages", "EmbedLinks"]) assertBotPermission(bot, p, channel);
      config.logChannel = channel.id;
      result = `Logs configurés dans <#${channel.id}>.`;
    } else if (action === "desactiver-logs") {
      config.logChannel = null;
      result = "Envoi au salon de logs désactivé. L’historique local est conservé.";
    } else throw new Error("Configuration inconnue.");
    this.store.save(i.guildId, config);
    this.store.record(i.guildId, null, actor.id, `acces.${action}`, result);
    return result + await this.log(i, config, `acces.${action}`, result);
  }
  async execute(i, actor, bot, config, group, action) {
    const o = i.options;
    const guild = i.guild;
    const reason = `${actor.user.tag} (${actor.id}) : ${o.getString("raison") || action}`.slice(0, 500);
    const user = o.getUser("membre");
    const selectedChannel = o.getChannel("salon");
    const channel = selectedChannel ? await guild.channels.fetch(selectedChannel.id) : null;
    if (selectedChannel && (!channel || !channel.permissionsFor(actor)?.has(P.ViewChannel))) throw new Error("Salon inaccessible.");
    if (channel) assertBotPermission(bot, "ViewChannel", channel);
    const role = o.getRole("role") ? await guild.roles.fetch(o.getRole("role").id) : null;
    if (group === "info") {
      if (action === "ping") return `Latence : ${i.client.ws.ping} ms.`;
      if (action === "serveur") return `${guild.name}\nID : ${guild.id}\nMembres : ${guild.memberCount}\nSalons : ${guild.channels.cache.size}\nRôles : ${guild.roles.cache.size}`;
      if (action === "membre") {
        const member = await guild.members.fetch(user.id);
        return `${member.user.tag}\nID : ${member.id}\nArrivée : ${member.joinedAt?.toISOString() ?? "inconnue"}\nNiveau : ${LEVELS[memberLevel(member, config)]}`;
      }
      if (action === "role") {
        if (!role) throw new Error("Rôle introuvable.");
        return `${role.name}\nID : ${role.id}\nPosition : ${role.position}\nCouleur : ${role.hexColor}`;
      }
      return `${channel.name}\nID : ${channel.id}\nType : ${ChannelType[channel.type]}`;
    }
    if (group === "moderation") {
      if (action === "avertissements" || action === "historique") {
        const rows = this.store.history(guild.id, user.id, action === "avertissements");
        return rows.map((row) => `#${row.id} — ${row.action}${row.active ? "" : " (retiré)"} — ${new Date(row.created_at).toISOString().slice(0, 10)} — ${row.reason.slice(0, 70)}`).join("\n") || "Aucun dossier.";
      }
      if (action === "debannir") {
        assertBotPermission(bot, "BanMembers");
        const id = o.getString("id", true);
        if (!idPattern.test(id)) throw new Error("ID Discord invalide.");
        await guild.bans.remove(id, reason);
        return `Utilisateur ${id} débanni. Motif : ${reason}`;
      }
      if (action === "bannissements") {
        assertBotPermission(bot, "BanMembers");
        const bans = await guild.bans.fetch({ limit: 15 });
        return bans.map((ban) => `${ban.user.tag} (${ban.user.id}) — ${ban.reason || "Sans motif"}`.slice(0, 120)).join("\n") || "Aucun bannissement.";
      }
      const target = await guild.members.fetch({ user: user.id, force: true });
      assertTarget(actor, target, bot, config);
      if (action === "avertir") {
        const id = this.store.record(guild.id, target.id, actor.id, "avertir", o.getString("raison", true));
        return `Avertissement #${id} enregistré pour ${target.user.tag}. Motif : ${reason}`;
      }
      if (action === "retirer-avertissement") {
        if (!this.store.removeWarning(guild.id, target.id, o.getInteger("numero", true))) throw new Error("Avertissement actif introuvable pour ce membre.");
      } else if (action === "timeout" || action === "untimeout") {
        assertBotPermission(bot, "ModerateMembers");
        if (!target.moderatable) throw new Error("Ce membre ne peut pas être exclu temporairement.");
        await target.timeout(action === "timeout" ? o.getInteger("minutes", true) * 60000 : null, reason);
      } else if (action === "expulser") {
        assertBotPermission(bot, "KickMembers");
        if (!target.kickable) throw new Error("Membre non expulsable.");
        await target.kick(reason);
      } else if (action === "bannir") {
        assertBotPermission(bot, "BanMembers");
        if (!target.bannable) throw new Error("Membre non bannissable.");
        await target.ban({ reason });
      } else if (action === "surnom" || action === "reset-surnom") {
        assertBotPermission(bot, "ManageNicknames");
        const nickname = action === "surnom" ? o.getString("nom", true) : null;
        if (nickname && nickname.length > 32) throw new Error("Le surnom est limité à 32 caractères.");
        await target.setNickname(nickname, reason);
      }
      return `${action} effectué pour ${target.user.tag}. Motif : ${reason}`;
    }
    if (group === "roles") {
      assertBotPermission(bot, "ManageRoles");
      if (action === "creer") {
        const created = await guild.roles.create({ name: o.getString("nom", true), permissions: [], reason });
        return `Rôle ordinaire créé : ${created.name} (${created.id}).`;
      }
      assertRole(actor, role, bot, config, this.jailDatabase.getSettings(guild.id));
      if (action === "donner" || action === "retirer") {
        const target = await guild.members.fetch({ user: user.id, force: true });
        assertTarget(actor, target, bot, config);
        await target.roles[action === "donner" ? "add" : "remove"](role, reason);
      } else if (action === "renommer") await role.setName(o.getString("nom", true), reason);
      else if (action === "couleur") {
        const hex = o.getString("hex", true);
        if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("Couleur attendue : #RRGGBB.");
        await role.setColor(Number.parseInt(hex.slice(1), 16), reason);
      } else if (action === "supprimer") await role.delete(reason);
      return `${action} effectué : rôle ${role.name} (${role.id})${user ? `, membre ${user.id}` : ""}.`;
    }
    if (group === "vocal") {
      const target = await guild.members.fetch({ user: user.id, force: true });
      assertTarget(actor, target, bot, config);
      if (!target.voice.channel) throw new Error("Le membre n’est pas connecté en vocal.");
      if (!target.voice.channel.permissionsFor(actor)?.has(P.ViewChannel)) throw new Error("Salon vocal source inaccessible.");
      const permission = action === "muet" ? "MuteMembers" : action === "sourd" ? "DeafenMembers" : "MoveMembers";
      assertBotPermission(bot, permission, target.voice.channel);
      if (action === "deplacer") {
        if (channel?.type !== ChannelType.GuildVoice) throw new Error("Choisis un salon vocal.");
        assertBotPermission(bot, "Connect", channel);
        assertBotPermission(bot, "MoveMembers", channel);
        if (!channel.permissionsFor(target)?.has(P.Connect)) throw new Error("Le membre n’a pas accès au salon de destination.");
        await target.voice.setChannel(channel, reason);
      } else if (action === "deconnecter") await target.voice.disconnect(reason);
      else if (action === "muet") await target.voice.setMute(o.getBoolean("activer", true), reason);
      else await target.voice.setDeaf(o.getBoolean("activer", true), reason);
      return `${action} effectué pour ${target.user.tag}. Motif : ${reason}`;
    }
    if (group === "messages") {
      if (channel?.type !== ChannelType.GuildText) throw new Error("Choisis un salon textuel standard.");
      assertBotPermission(bot, "ReadMessageHistory", channel);
      if (action === "annoncer") {
        assertBotPermission(bot, "SendMessages", channel);
        const message = await channel.send({ content: o.getString("texte", true), allowedMentions: { parse: [] } });
        return `Annonce publiée : ${message.url}`;
      }
      assertBotPermission(bot, "ManageMessages", channel);
      if (action === "nettoyer") {
        const messages = await channel.bulkDelete(o.getInteger("nombre", true), true);
        return `${messages.size} message(s) supprimé(s) dans ${channel.name}. Les messages de plus de 14 jours sont conservés.`;
      }
      const id = o.getString("id", true);
      if (!idPattern.test(id)) throw new Error("ID de message invalide.");
      const message = await channel.messages.fetch(id);
      if (action === "epingler") await message.pin(reason);
      else await message.unpin(reason);
      return `${action} effectué sur le message ${id}.`;
    }
    if (group === "salons") return this.manageChannel(i, actor, bot, config, channel, action, reason);
    throw new Error("Action non implémentée.");
  }
  async manageChannel(i, actor, bot, config, channel, action, reason) {
    const o = i.options;
    const guild = i.guild;
    assertBotPermission(bot, "ManageChannels", channel);
    if (action.startsWith("creer-")) {
      const type = { "creer-texte": ChannelType.GuildText, "creer-vocal": ChannelType.GuildVoice, "creer-categorie": ChannelType.GuildCategory }[action];
      const created = await guild.channels.create({ name: o.getString("nom", true), type, reason });
      return `Salon créé : ${created.name} (${created.id}).`;
    }
    const jail = this.jailDatabase.getSettings(guild.id);
    if ([jail.jail_category_id, jail.jail_channel_id, jail.log_channel_id, config.logChannel].includes(channel.id)) {
      throw new Error("Salon de système Jail ou de logs protégé.");
    }
    if (action === "renommer") await channel.setName(o.getString("nom", true), reason);
    else if (action === "supprimer") {
      if (channel.type === ChannelType.GuildCategory && channel.children.cache.size) throw new Error("Déplace les salons enfants avant de supprimer cette catégorie.");
      if (channel.id === i.channelId) throw new Error("Lance cette commande depuis un autre salon.");
      await channel.delete(reason);
    } else if (action === "deplacer") {
      if (channel.type === ChannelType.GuildCategory) throw new Error("Une catégorie ne peut pas avoir de parent.");
      const category = await guild.channels.fetch(o.getChannel("categorie", true).id);
      if (category?.type !== ChannelType.GuildCategory || !category.permissionsFor(actor)?.has(P.ViewChannel) || category.id === jail.jail_category_id) throw new Error("Catégorie invalide ou protégée.");
      await channel.setParent(category, { lockPermissions: false, reason });
    } else if (action === "limite-vocale") {
      if (channel.type !== ChannelType.GuildVoice) throw new Error("Choisis un salon vocal.");
      await channel.setUserLimit(o.getInteger("nombre", true), reason);
    } else {
      if (channel.type !== ChannelType.GuildText) throw new Error("Choisis un salon textuel standard.");
      if (action === "sujet") await channel.setTopic(o.getString("texte", true), reason);
      else if (action === "ralentir") await channel.setRateLimitPerUser(o.getInteger("secondes", true), reason);
      else {
        assertBotPermission(bot, "ManageRoles", channel);
        config.locks ??= {};
        if (action === "verrouiller") {
          if (config.locks[channel.id]) throw new Error("Salon déjà verrouillé par le bot.");
          const overwrite = channel.permissionOverwrites.cache.get(guild.id);
          const fields = ["SendMessages", "SendMessagesInThreads", "CreatePublicThreads", "CreatePrivateThreads"];
          config.locks[channel.id] = Object.fromEntries(fields.map((key) => [key, triState(overwrite, P[key])]));
          this.store.save(guild.id, config);
          try {
            await channel.permissionOverwrites.edit(guild.id, Object.fromEntries(fields.map((key) => [key, false])), { reason });
          } catch (error) {
            delete config.locks[channel.id];
            this.store.save(guild.id, config);
            throw error;
          }
        } else if (action === "deverrouiller") {
          if (!config.locks[channel.id]) throw new Error("Aucun verrouillage enregistré pour ce salon.");
          await channel.permissionOverwrites.edit(guild.id, config.locks[channel.id], { reason });
          delete config.locks[channel.id];
          this.store.save(guild.id, config);
        }
        return `${action} effectué sur ${channel.name}. Les autorisations explicites d’autres rôles peuvent toujours permettre d’écrire.`;
      }
    }
    return `${action} effectué sur ${channel.name} (${channel.id}).`;
  }
}
