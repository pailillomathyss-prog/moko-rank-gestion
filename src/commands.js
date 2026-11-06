import {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

const reason = (option) =>
  option
    .setName("raison")
    .setDescription("Motif de l’action.")
    .setMaxLength(400)
    .setRequired(false);

const member = (option) =>
  option.setName("membre").setDescription("Membre concerné.").setRequired(true);

export const slashCommands = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Affiche les commandes du bot."),
  new SlashCommandBuilder()
    .setName("staff")
    .setDescription("Gère le rôle et les membres du staff.")
    .addSubcommand((sub) =>
      sub
        .setName("role")
        .setDescription("Configure le rôle staff.")
        .addRoleOption((option) =>
          option.setName("role").setDescription("Rôle staff").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("ajouter")
        .setDescription("Ajoute un membre au staff.")
        .addUserOption(member),
    )
    .addSubcommand((sub) =>
      sub
        .setName("retirer")
        .setDescription("Retire un membre du staff.")
        .addUserOption(member),
    )
    .addSubcommand((sub) =>
      sub.setName("liste").setDescription("Affiche le staff du serveur."),
    ),
  new SlashCommandBuilder()
    .setName("mod")
    .setDescription("Commandes de modération du serveur.")
    .addSubcommand((sub) =>
      sub
        .setName("kick")
        .setDescription("Expulse un membre.")
        .addUserOption(member)
        .addStringOption(reason),
    )
    .addSubcommand((sub) =>
      sub
        .setName("ban")
        .setDescription("Bannit un membre.")
        .addUserOption(member)
        .addStringOption(reason),
    )
    .addSubcommand((sub) =>
      sub
        .setName("unban")
        .setDescription("Lève un bannissement avec un ID Discord.")
        .addStringOption((option) =>
          option
            .setName("id")
            .setDescription("ID Discord de la personne.")
            .setRequired(true)
            .setMaxLength(22),
        )
        .addStringOption(reason),
    )
    .addSubcommand((sub) =>
      sub
        .setName("timeout")
        .setDescription("Met un membre en timeout.")
        .addUserOption(member)
        .addStringOption((option) =>
          option
            .setName("duree")
            .setDescription("Exemple : 10m, 2h ou 1d.")
            .setRequired(true)
            .setMaxLength(12),
        )
        .addStringOption(reason),
    )
    .addSubcommand((sub) =>
      sub
        .setName("untimeout")
        .setDescription("Retire le timeout d’un membre.")
        .addUserOption(member),
    )
    .addSubcommand((sub) =>
      sub
        .setName("clear")
        .setDescription("Supprime des messages récents.")
        .addIntegerOption((option) =>
          option
            .setName("nombre")
            .setDescription("Nombre de messages, de 1 à 100.")
            .setMinValue(1)
            .setMaxValue(100)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("warn")
        .setDescription("Ajoute un avertissement.")
        .addUserOption(member)
        .addStringOption(reason),
    )
    .addSubcommand((sub) =>
      sub
        .setName("warnings")
        .setDescription("Affiche les avertissements d’un membre.")
        .addUserOption(member),
    )
    .addSubcommand((sub) =>
      sub
        .setName("effacer_warnings")
        .setDescription("Efface les avertissements d’un membre.")
        .addUserOption(member),
    ),
  new SlashCommandBuilder()
    .setName("brigade")
    .setDescription("Configure les permissions de la brigade jail.")
    .addSubcommand((sub) =>
      sub
        .setName("role")
        .setDescription("Définit le rôle autorisé à gérer le jail.")
        .addRoleOption((option) =>
          option.setName("role").setDescription("Rôle brigade").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("jail")
        .setDescription("Configure le rôle et le salon de jail.")
        .addRoleOption((option) =>
          option.setName("role").setDescription("Rôle jail").setRequired(true),
        )
        .addChannelOption((option) =>
          option.setName("salon").setDescription("Salon réservé au jail").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("etat").setDescription("Affiche la configuration jail."),
    ),
  new SlashCommandBuilder()
    .setName("jail")
    .setDescription("Place un membre en jail.")
    .addUserOption(member)
    .addStringOption(reason),
  new SlashCommandBuilder()
    .setName("unjail")
    .setDescription("Libère un membre du jail.")
    .addUserOption(member),
];

export function createHelpEmbeds() {
  const staff = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Gestion du staff")
    .setDescription(
      "Commandes pour définir le rôle staff et gérer les membres qui le portent.",
    )
    .addFields(
      {
        name: "Commandes",
        value:
          "`/staff role role:@Staff` — définit le rôle staff.\n`/staff ajouter membre:@Membre` — attribue ce rôle.\n`/staff retirer membre:@Membre` — retire ce rôle.\n`/staff liste` — affiche les membres staff présents dans le cache du bot.",
      },
      {
        name: "Permission requise",
        value:
          "Toutes les commandes `/staff` exigent la permission Discord **Gérer les rôles**. Le rôle staff ne donne pas automatiquement de permissions de modération.",
      },
      {
        name: "Limites de sécurité",
        value:
          "Le rôle choisi ne peut pas être administrateur et doit être placé sous le rôle du bot. Un membre ne peut gérer que des membres plus bas que son propre rôle (sauf le propriétaire du serveur).",
      },
    );

  const moderation = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("Modération")
    .setDescription("Chaque commande vérifie la permission Discord indiquée.")
    .addFields(
      {
        name: "Expulsions et bannissements",
        value:
          "`/mod kick` — **Expulser des membres**.\n`/mod ban` et `/mod unban` — **Bannir des membres**. Pour `/mod unban`, indique l’ID Discord.",
      },
      {
        name: "Timeouts",
        value:
          "`/mod timeout` et `/mod untimeout` — **Modérer les membres**. Durée acceptée : de 10 secondes à 28 jours, par exemple `10m`, `2h` ou `1d`.",
      },
      {
        name: "Messages et avertissements",
        value:
          "`/mod clear` — **Gérer les messages**, de 1 à 100 messages récents.\n`/mod warn`, `/mod warnings` et `/mod effacer_warnings` — **Gérer les messages**. Les avertissements sont conservés dans la base SQLite.",
      },
      {
        name: "Hiérarchie",
        value:
          "Le modérateur ne peut pas cibler un membre ayant un rôle égal ou supérieur au sien. Discord peut aussi bloquer une action si le rôle du bot est trop bas.",
      },
    );

  const brigade = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("Brigade jail — permissions")
    .setDescription(
      "Le rôle brigade est une autorisation vérifiée par le bot ; il ne confère pas de permissions Discord supplémentaires.",
    )
    .addFields(
      {
        name: "Configurer",
        value:
          "`/brigade role role:@Brigade` — définit le rôle autorisé à jail/libérer.\n`/brigade jail role:@Jail salon:#jail` — définit le rôle de restriction et le salon dédié.\n`/brigade etat` — vérifie les réglages.",
      },
      {
        name: "Qui peut configurer ?",
        value:
          "Les commandes de configuration `/brigade` exigent **Gérer le serveur**. Le bot doit aussi avoir **Gérer les rôles** et son rôle doit être au-dessus du rôle jail.",
      },
      {
        name: "Qui peut jail/libérer ?",
        value:
          "Les commandes `/jail` et `/unjail` sont réservées aux membres portant le rôle brigade configuré, ainsi qu’aux membres ayant **Gérer le serveur**.",
      },
    );

  const jailGuide = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("Jail — fonctionnement et étapes")
    .setDescription(
      "Le jail est appliqué dans ce serveur uniquement. Le bot ne vérifie pas l’appartenance d’un membre à d’autres serveurs.",
    )
    .addFields(
      {
        name: "1. Préparer les rôles et le salon",
        value:
          "Crée un rôle `Brigade` pour les agents autorisés et attribue-le aux membres concernés. Crée un rôle `Jail` et un salon textuel privé, par exemple `#jail`.",
      },
      {
        name: "2. Configurer le bot",
        value:
          "Avec **Gérer le serveur**, lance `/brigade role role:@Brigade`, puis `/brigade jail role:@Jail salon:#jail`. Termine avec `/brigade etat` pour vérifier.",
      },
      {
        name: "3. Mettre un membre en jail",
        value:
          "Un membre autorisé lance `/jail membre:@Membre raison:Motif`. Le bot attribue le rôle Jail, enregistre le motif et l’agent dans SQLite, puis envoie une annonce avec mention dans le salon configuré.",
      },
      {
        name: "4. Libérer le membre",
        value:
          "Un membre autorisé lance `/unjail membre:@Membre`. Le bot retire le rôle Jail et supprime l’enregistrement du jail.",
      },
      {
        name: "Accès et précautions",
        value:
          "La configuration applique des refus d’accès/salon, d’écriture, de commandes, de connexion vocale et de prise de parole au rôle Jail dans les salons existants, sauf le salon jail où ces accès sont autorisés. Le bot doit avoir **Gérer les rôles** et son rôle doit être au-dessus du rôle Jail. Les permissions accordées par d’autres rôles peuvent modifier l’accès effectif. Si de nouveaux salons sont créés, relance `/brigade jail` pour appliquer les restrictions.",
      },
    )
    .setFooter({
      text: "Le jail ne bannit pas et ne retire pas les autres rôles du membre.",
    });

  return [staff, moderation, brigade, jailGuide];
}

function hasPermission(member, permission) {
  return Boolean(member?.permissions.has(permission));
}

function isBrigade(member, settings) {
  return (
    hasPermission(member, PermissionFlagsBits.ManageGuild) ||
    Boolean(settings.brigade_role_id && member?.roles.cache.has(settings.brigade_role_id))
  );
}

function validRole(role, guild, botMember) {
  return Boolean(
    role &&
      role.id !== guild.id &&
      !role.managed &&
      !role.permissions.has(PermissionFlagsBits.Administrator) &&
      role.position < botMember.roles.highest.position,
  );
}

async function applyJailPermissions(guild, role, room) {
  const botMember = guild.members.me ?? (await guild.members.fetchMe());
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error("Le bot doit avoir la permission Gérer les rôles.");
  }
  if (role.position >= botMember.roles.highest.position) {
    throw new Error("Place le rôle du bot au-dessus du rôle jail.");
  }

  for (const channel of guild.channels.cache.values()) {
    if (!channel.permissionOverwrites?.edit) continue;
    const permissions =
      channel.id === room.id
        ? {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            UseApplicationCommands: true,
          }
        : {
            ViewChannel: false,
            SendMessages: false,
            SendMessagesInThreads: false,
            UseApplicationCommands: false,
            Connect: false,
            Speak: false,
          };
    await channel.permissionOverwrites.edit(role, permissions);
  }
}

function parseDuration(value) {
  const match = /^([1-9]\d*)(s|m|h|d)$/i.exec(value ?? "");
  if (!match) return null;
  const multiplier = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[
    match[2].toLowerCase()
  ];
  const milliseconds = Number(match[1]) * multiplier;
  return milliseconds >= 10_000 && milliseconds <= 28 * 86_400_000
    ? milliseconds
    : null;
}

export class CommandHandler {
  constructor(database) {
    this.database = database;
  }

  async handle(interaction) {
    const { guild } = interaction;
    if (!guild) {
      await interaction.reply({ content: "Utilise cette commande dans un serveur.", ephemeral: true });
      return;
    }
    this.database.ensureGuild(guild.id);

    if (interaction.commandName === "help") {
      await interaction.reply({ embeds: createHelpEmbeds(), ephemeral: true });
      return;
    }

    const actor =
      guild.members.cache.get(interaction.user.id) ??
      (await guild.members.fetch(interaction.user.id).catch(() => null));
    if (!actor) {
      await interaction.reply({
        content: "Je n’arrive pas à vérifier tes permissions sur ce serveur.",
        ephemeral: true,
      });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      if (interaction.commandName === "staff") {
        await this.handleStaff(interaction, actor);
      } else if (interaction.commandName === "mod") {
        await this.handleModeration(interaction, actor);
      } else if (interaction.commandName === "brigade") {
        await this.handleBrigade(interaction, actor);
      } else if (interaction.commandName === "jail") {
        await this.jail(interaction, actor);
      } else if (interaction.commandName === "unjail") {
        await this.unjail(interaction, actor);
      }
    } catch (error) {
      console.error(`/${interaction.commandName} failed in guild ${guild.id}.`, error);
      await interaction.editReply(`Action impossible : ${error.message}`);
    }
  }

  async handleStaff(interaction, actor) {
    const { guild } = interaction;
    const action = interaction.options.getSubcommand();
    const settings = this.database.getGuild(guild.id);
    const role = settings.staff_role_id
      ? guild.roles.cache.get(settings.staff_role_id)
      : null;

    if (!hasPermission(actor, PermissionFlagsBits.ManageRoles)) {
      await interaction.editReply("Il faut la permission **Gérer les rôles**.");
      return;
    }
    if (action === "role") {
      const newRole = interaction.options.getRole("role");
      const botMember = guild.members.me ?? (await guild.members.fetchMe());
      if (
        !validRole(newRole, guild, botMember) ||
        (guild.ownerId !== actor.id &&
          newRole.position >= actor.roles.highest.position)
      ) {
        await interaction.editReply("Choisis un rôle non administrateur et placé sous le rôle du bot.");
        return;
      }
      this.database.setRole(guild.id, "staff", newRole.id);
      await interaction.editReply(`Rôle staff configuré : ${newRole}.`);
      return;
    }

    if (!role) {
      await interaction.editReply("Configure d’abord le rôle avec `/staff role`.");
      return;
    }
    if (action === "liste") {
      const staff = [...guild.members.cache.values()]
        .filter((entry) => entry.roles.cache.has(role.id))
        .slice(0, 30);
      await interaction.editReply(
        staff.length
          ? `**Staff (${staff.length})**\n${staff.map((entry) => `• ${entry.user.tag}`).join("\n")}`
          : "Aucun membre staff trouvé.",
      );
      return;
    }
    const targetUser = interaction.options.getUser("membre");
    const target = await guild.members.fetch(targetUser.id);
    const botMember = guild.members.me ?? (await guild.members.fetchMe());
    if (target.roles.highest.position >= botMember.roles.highest.position) {
      await interaction.editReply("Le rôle du bot doit être placé au-dessus de ce membre.");
      return;
    }
    if (
      target.roles.highest.position >= actor.roles.highest.position &&
      guild.ownerId !== actor.id
    ) {
      await interaction.editReply("Tu ne peux pas gérer un membre ayant un rôle égal ou supérieur au tien.");
      return;
    }
    if (action === "ajouter") {
      await target.roles.add(role, `Ajout au staff par ${interaction.user.tag}.`);
      await interaction.editReply(`${target.user.tag} a rejoint le staff.`);
    } else {
      await target.roles.remove(role, `Retrait du staff par ${interaction.user.tag}.`);
      await interaction.editReply(`${target.user.tag} a quitté le staff.`);
    }
  }

  async handleModeration(interaction, actor) {
    const { guild } = interaction;
    const action = interaction.options.getSubcommand();
    const targetUser = interaction.options.getUser("membre");
    const target = targetUser
      ? await guild.members.fetch(targetUser.id).catch(() => null)
      : null;
    const reasonText =
      interaction.options.getString("raison") || "Aucune raison précisée.";
    const requiredPermission = {
      kick: PermissionFlagsBits.KickMembers,
      ban: PermissionFlagsBits.BanMembers,
      unban: PermissionFlagsBits.BanMembers,
      timeout: PermissionFlagsBits.ModerateMembers,
      untimeout: PermissionFlagsBits.ModerateMembers,
      clear: PermissionFlagsBits.ManageMessages,
      warn: PermissionFlagsBits.ManageMessages,
      warnings: PermissionFlagsBits.ManageMessages,
      effacer_warnings: PermissionFlagsBits.ManageMessages,
    }[action];
    if (!hasPermission(actor, requiredPermission)) {
      await interaction.editReply("Tu n’as pas la permission Discord nécessaire.");
      return;
    }

    if (action === "clear") {
      const amount = interaction.options.getInteger("nombre");
      if (!interaction.channel?.bulkDelete) {
        await interaction.editReply("Cette commande exige un salon textuel.");
        return;
      }
      const deleted = await interaction.channel.bulkDelete(amount, true);
      await interaction.editReply(`${deleted.size} message(s) supprimé(s).`);
      return;
    }
    if (action === "unban") {
      const id = interaction.options.getString("id");
      if (!/^\d{15,22}$/.test(id)) {
        await interaction.editReply("L’ID Discord n’est pas valide.");
        return;
      }
      await guild.members.unban(id, reasonText);
      await interaction.editReply(`Bannissement levé pour \`${id}\`.`);
      return;
    }
    if (!target) {
      await interaction.editReply("Membre introuvable dans ce serveur.");
      return;
    }
    if (target.id === actor.id || target.roles.highest.position >= actor.roles.highest.position && guild.ownerId !== actor.id) {
      await interaction.editReply("Tu ne peux pas appliquer cette action à ce membre.");
      return;
    }

    if (action === "kick") {
      await target.kick(reasonText);
      await interaction.editReply(`${target.user.tag} a été expulsé.`);
    } else if (action === "ban") {
      await guild.members.ban(target.id, { reason: reasonText });
      await interaction.editReply(`${target.user.tag} a été banni.`);
    } else if (action === "timeout" || action === "untimeout") {
      const duration =
        action === "timeout"
          ? parseDuration(interaction.options.getString("duree"))
          : null;
      if (action === "timeout" && !duration) {
        await interaction.editReply("Durée invalide : indique 10s à 28d, par exemple `10m`.");
        return;
      }
      await target.timeout(duration, reasonText);
      await interaction.editReply(
        action === "timeout"
          ? `${target.user.tag} est en timeout.`
          : `Timeout retiré pour ${target.user.tag}.`,
      );
    } else if (action === "warn") {
      const id = this.database.addWarning(guild.id, target.id, actor.id, reasonText);
      await interaction.editReply(`${target.user.tag} a reçu un avertissement (#${id}).`);
    } else if (action === "warnings") {
      const warnings = this.database.getWarnings(guild.id, target.id);
      await interaction.editReply(
        warnings.length
          ? warnings.map((entry) => `#${entry.id} — ${entry.reason}`).join("\n")
          : "Aucun avertissement enregistré.",
      );
    } else if (action === "effacer_warnings") {
      const removed = this.database.clearWarnings(guild.id, target.id);
      await interaction.editReply(`${removed} avertissement(s) effacé(s).`);
    }
  }

  async handleBrigade(interaction, actor) {
    const { guild } = interaction;
    const action = interaction.options.getSubcommand();
    const settings = this.database.getGuild(guild.id);
    if (!hasPermission(actor, PermissionFlagsBits.ManageGuild)) {
      await interaction.editReply("Il faut la permission **Gérer le serveur** pour configurer la brigade.");
      return;
    }
    if (action === "role") {
      const role = interaction.options.getRole("role");
      const botMember = guild.members.me ?? (await guild.members.fetchMe());
      if (!validRole(role, guild, botMember)) {
        await interaction.editReply("Choisis un rôle non administrateur et placé sous le rôle du bot.");
        return;
      }
      this.database.setRole(guild.id, "brigade", role.id);
      await interaction.editReply(`Rôle brigade configuré : ${role}.`);
      return;
    }
    if (action === "jail") {
      const role = interaction.options.getRole("role");
      const channel = interaction.options.getChannel("salon");
      const botMember = guild.members.me ?? (await guild.members.fetchMe());
      if (!validRole(role, guild, botMember) || !channel?.isTextBased?.() || !channel.permissionOverwrites?.edit) {
        await interaction.editReply("Choisis un rôle jail valide et un salon textuel.");
        return;
      }
      await applyJailPermissions(guild, role, channel);
      this.database.setRole(guild.id, "jail", role.id);
      this.database.setJailChannel(guild.id, channel.id);
      await interaction.editReply(`Jail configuré : ${role} et ${channel}.`);
      return;
    }
    await interaction.editReply(
      `**Configuration brigade**\nRôle brigade : ${settings.brigade_role_id ? `<@&${settings.brigade_role_id}>` : "non configuré"}\nRôle jail : ${settings.jail_role_id ? `<@&${settings.jail_role_id}>` : "non configuré"}\nSalon jail : ${settings.jail_channel_id ? `<#${settings.jail_channel_id}>` : "non configuré"}`,
    );
  }

  async jail(interaction, actor) {
    const { guild } = interaction;
    const settings = this.database.getGuild(guild.id);
    if (!isBrigade(actor, settings)) {
      await interaction.editReply("Commande réservée à la brigade jail.");
      return;
    }
    const role = settings.jail_role_id
      ? guild.roles.cache.get(settings.jail_role_id)
      : null;
    const targetUser = interaction.options.getUser("membre");
    const target = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!role || !settings.jail_channel_id) {
      await interaction.editReply("Configure d’abord `/brigade jail`.");
      return;
    }
    if (!target || target.id === guild.ownerId || target.permissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.editReply("Ce membre ne peut pas être jailé.");
      return;
    }
    await target.roles.add(role, interaction.options.getString("raison") || "Jail par la brigade.");
    this.database.setJail(
      guild.id,
      target.id,
      interaction.options.getString("raison") || "Jail par la brigade.",
      actor.id,
    );
    const channel = guild.channels.cache.get(settings.jail_channel_id);
    await channel
      ?.send({
        content: `🔒 <@${target.id}> a été placé en jail.`,
        allowedMentions: { users: [target.id] },
      })
      .catch(() => undefined);
    await interaction.editReply(`${target.user.tag} a été jailé.`);
  }

  async unjail(interaction, actor) {
    const { guild } = interaction;
    const settings = this.database.getGuild(guild.id);
    if (!isBrigade(actor, settings)) {
      await interaction.editReply("Commande réservée à la brigade jail.");
      return;
    }
    const targetUser = interaction.options.getUser("membre");
    const target = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!target) {
      await interaction.editReply("Membre introuvable.");
      return;
    }
    if (settings.jail_role_id && target.roles.cache.has(settings.jail_role_id)) {
      await target.roles.remove(settings.jail_role_id, "Libération par la brigade.");
    }
    this.database.removeJail(guild.id, target.id);
    await interaction.editReply(`${target.user.tag} a été libéré du jail.`);
  }
}
