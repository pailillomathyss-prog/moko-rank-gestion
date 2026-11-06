import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { scanGuildOverlap } from "./membership-monitor.js";
import { ManagementStore } from "./management-store.js";
import { assertAccess, assertTarget, memberLevel } from "./access.js";
import { JAIL_ACCESS } from "./management-commands.js";

const MEMBER_NAME = "membre";
const RANK_COUNT = 5;
const JAIL_DENIES = {
  ViewChannel: false,
  SendMessages: false,
  SendMessagesInThreads: false,
  UseApplicationCommands: false,
  Connect: false,
  Speak: false,
  CreatePublicThreads: false,
  CreatePrivateThreads: false,
  AddReactions: false,
  AttachFiles: false,
  EmbedLinks: false,
};

export const jailCommand = new SlashCommandBuilder()
  .setName("jail")
  .setDescription("Configure et gère le système de jail.")
  .addSubcommand((sub) =>
    sub.setName("setup").setDescription("Crée les rôles et salons du jail."),
  )
  .addSubcommand((sub) =>
    sub
      .setName("mettre")
      .setDescription("Place un membre en jail.")
      .addUserOption((option) =>
        option.setName(MEMBER_NAME).setDescription("Membre à jailer.").setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("raison")
          .setDescription("Motif de la mise en jail.")
          .setMaxLength(400)
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("liberer")
      .setDescription("Libère un membre et augmente son rang.")
      .addUserOption((option) =>
        option.setName(MEMBER_NAME).setDescription("Membre à libérer.").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("etat").setDescription("Affiche la configuration du jail."),
  )
  .addSubcommand((sub) =>
    sub
      .setName("surveillance")
      .setDescription("Autorise ou révoque le contrôle des arrivées dans ce serveur.")
      .addBooleanOption((option) =>
        option
          .setName("activer")
          .setDescription("Autoriser les serveurs communautaires configurés.")
          .setRequired(true),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName("serveurs")
      .setDescription("Configure les serveurs communautaires autorisés.")
      .addSubcommand((sub) =>
        sub
          .setName("ajouter")
          .setDescription("Ajoute un serveur autorisé à la surveillance.")
          .addStringOption((option) =>
            option
              .setName("id")
              .setDescription("ID du serveur où le bot est installé.")
              .setRequired(true)
              .setMaxLength(22),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("retirer")
          .setDescription("Retire un serveur de la surveillance.")
          .addStringOption((option) =>
            option
              .setName("id")
              .setDescription("ID du serveur à retirer.")
              .setRequired(true)
              .setMaxLength(22),
          ),
      )
      .addSubcommand((sub) =>
        sub.setName("liste").setDescription("Liste les serveurs configurés."),
      ),
  );

export function buildJailGuide(settings) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Jail — guide de configuration")
    .setDescription(
      "Le jail limite l’accès au serveur configuré. Configure-le avec `/jail setup`, puis associe le rôle Brigade au niveau Assistant avec `/acces role`.",
    )
    .addFields(
      {
        name: "Configurer le système",
        value:
          "Un administrateur de gestion (niveau 3) ou le propriétaire lance `/jail setup`. Le bot crée ou actualise la catégorie, les salons et les rôles dédiés.",
      },
      {
        name: "Salons et rôles créés",
        value:
          "Catégorie `JAIL` avec `#cellule-jail` pour les membres jailés et `#logs-jail` pour la brigade. Le bot crée aussi `Brigade Jail`, `Jail` et cinq rôles de progression.",
      },
      {
        name: "Mettre en jail",
        value:
          "Un membre de la brigade utilise `/jail mettre membre:@Membre raison:Motif`. Le bot ajoute le rôle Jail, enregistre le motif et publie l’action dans `#logs-jail`.",
      },
      {
        name: "Libérer et progresser",
        value:
          "La brigade utilise `/jail liberer membre:@Membre`. À chaque libération enregistrée, le bot incrémente le compteur et attribue le rang suivant, jusqu’au rang maximal. Les noms des rôles peuvent être renommés dans les paramètres Discord.",
      },
      {
        name: "Permissions requises",
        value:
          "Configuration : niveau Administrateur (3). Jail/libération : niveau Assistant (1). Le propriétaire associe les rôles avec `/acces role`. La permission Discord Gérer le serveur ne donne pas de niveau automatique. Le bot doit avoir Gérer les rôles et Gérer les salons, avec un rôle au-dessus des membres et rôles concernés.",
      },
      {
        name: "À savoir",
        value:
          "Le bot applique les restrictions aux salons existants et nouveaux. Les permissions d’autres rôles peuvent affecter l’accès effectif. La détection surveille uniquement les serveurs installés et autorisés; l’ajout d’un ID lance un scan immédiat, puis les nouvelles arrivées sont suivies.",
      },
      {
        name: "Détection inter-serveurs",
        value:
          "Chaque serveur surveillé doit d’abord lancer `/jail surveillance activer`. Ensuite, un responsable de ton serveur utilise `/jail serveurs ajouter id:...`; le bot scanne les membres actuels et jail les correspondances, puis traite les nouvelles arrivées. La libération reste manuelle.",
      },
    )
    .setFooter({
      text: settings?.brigade_role_id
        ? "Configuration enregistrée. Vérifie avec /jail etat."
        : "Aucune configuration enregistrée pour ce serveur.",
    });
}

export function buildJailRoomEmbed() {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("Guide du jail — à lire")
    .setDescription(
      "Tu es dans l’espace réservé aux membres placés en jail. Les échanges avec la brigade se font dans ce salon.",
    )
    .addFields(
      {
        name: "Pourquoi suis-je ici ?",
        value:
          "La brigade a enregistré le motif de ton jail. Si la mesure est automatique, le bot a détecté ta présence dans un serveur surveillé dont l’équipe dirigeante a donné son accord. La détection peut avoir lieu lors d’un scan ou d’une arrivée. Si tu penses qu’il s’agit d’une erreur, demande une vérification à la brigade.",
      },
      {
        name: "Que faire maintenant ?",
        value:
          "Écris dans ce salon pour demander des explications ou contacter un membre de la brigade. Respecte les consignes du serveur pendant l’examen de ta situation.",
      },
      {
        name: "Comment se passe la libération ?",
        value:
          "La libération est faite par la brigade après vérification; elle n’est pas automatique. À la libération, le bot retire le rôle Jail et attribue le rang de progression suivant, jusqu’au rang maximal configuré.",
      },
      {
        name: "À savoir",
        value:
          "Le rôle Jail limite l’accès aux autres salons du serveur. Le motif et les actions de la brigade sont conservés dans les logs du serveur.",
      },
    )
    .setFooter({ text: "Pour toute question, contacte la brigade dans ce salon." });
}

function hasJailSetup(settings) {
  return Boolean(
    settings.brigade_role_id &&
      settings.jail_role_id &&
      settings.jail_category_id &&
      settings.jail_channel_id &&
      settings.log_channel_id &&
      settings.rank_role_ids.length,
  );
}

async function ensureRole(guild, name, storedId, reason) {
  const stored = storedId ? guild.roles.cache.get(storedId) : null;
  if (stored) {
    if (stored.permissions.has(PermissionFlagsBits.Administrator)) {
      throw new Error(
        `Le rôle enregistré « ${stored.name} » est administrateur. Retire cette permission avant de continuer.`,
      );
    }
    return stored;
  }
  const existing = guild.roles.cache.find((role) => role.name === name);
  if (existing) {
    if (existing.permissions.has(PermissionFlagsBits.Administrator)) {
      throw new Error(
        `Le rôle « ${name} » est administrateur. Renomme-le ou retire sa permission Administrateur avant le setup.`,
      );
    }
    return existing;
  }
  return guild.roles.create({
    name,
    permissions: [],
    mentionable: false,
    reason,
  });
}

async function ensureCategory(guild, storedId, jailRole, brigadeRole, botMember) {
  const storedCategory = storedId
    ? guild.channels.cache.get(storedId)
    : null;
  const category =
    storedCategory?.type === ChannelType.GuildCategory
      ? storedCategory
      : guild.channels.cache.find(
          (channel) =>
            channel.type === ChannelType.GuildCategory && channel.name === "JAIL",
        );
  const result =
    category ??
    (await guild.channels.create({
      name: "JAIL",
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: jailRole.id,
        allow: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: brigadeRole.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: botMember.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
        ],
      },
      ],
    }));
  if (category) {
    await result.permissionOverwrites.set([
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: jailRole.id, allow: [PermissionFlagsBits.ViewChannel] },
      {
        id: brigadeRole.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: botMember.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
        ],
      },
    ]);
  }
  return result;
}

async function ensureTextChannel(guild, name, category, overwrites) {
  const existing = guild.channels.cache.find(
    (channel) =>
      channel.parentId === category.id &&
      channel.type === ChannelType.GuildText &&
      channel.name === name,
  );
  if (existing) {
    await existing.permissionOverwrites.set(overwrites);
    return existing;
  }
  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites: overwrites,
  });
}

export async function applyJailRestriction(channel, jailRoleId) {
  if (
    !channel.permissionOverwrites?.edit ||
    channel.type === ChannelType.GuildCategory
  ) {
    return;
  }
  await channel.permissionOverwrites.edit(jailRoleId, JAIL_DENIES);
}

export async function setupJail(guild, database) {
  const botMember = guild.members.me ?? (await guild.members.fetchMe());
  if (
    !botMember.permissions.has(PermissionFlagsBits.ManageRoles) ||
    !botMember.permissions.has(PermissionFlagsBits.ManageChannels)
  ) {
    throw new Error(
      "Le bot doit avoir les permissions Gérer les rôles et Gérer les salons.",
    );
  }
  const old = database.getSettings(guild.id);
  const brigade = await ensureRole(
    guild,
    "Brigade Jail",
    old.brigade_role_id,
    "Configuration du système de jail.",
  );
  const jailRole = await ensureRole(
    guild,
    "Jail",
    old.jail_role_id,
    "Configuration du système de jail.",
  );
  const ranks = [];
  for (let index = 1; index <= RANK_COUNT; index += 1) {
    ranks.push(
      await ensureRole(
        guild,
        `Jail Rang ${index}`,
        old.rank_role_ids[index - 1],
        "Création des rôles de progression du jail.",
      ),
    );
  }
  for (const role of [brigade, jailRole, ...ranks]) {
    if (role.position >= botMember.roles.highest.position) {
      throw new Error(
        `Place le rôle du bot au-dessus de « ${role.name} », puis relance /jail setup.`,
      );
    }
  }

  const category = await ensureCategory(
    guild,
    old.jail_category_id,
    jailRole,
    brigade,
    botMember,
  );
  const categoryRoomOverwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: jailRole.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.UseApplicationCommands,
      ],
    },
    {
      id: brigade.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    {
      id: botMember.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];
  const logsOverwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: jailRole.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: brigade.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    {
      id: botMember.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];
  const jailChannel = await ensureTextChannel(
    guild,
    "cellule-jail",
    category,
    categoryRoomOverwrites,
  );
  const logChannel = await ensureTextChannel(
    guild,
    "logs-jail",
    category,
    logsOverwrites,
  );

  const setup = {
    brigadeRoleId: brigade.id,
    jailRoleId: jailRole.id,
    categoryId: category.id,
    jailChannelId: jailChannel.id,
    logChannelId: logChannel.id,
    rankRoleIds: ranks.map((role) => role.id),
  };
  database.saveSetup(guild.id, setup);
  for (const channel of guild.channels.cache.values()) {
    if (channel.id !== jailChannel.id && channel.id !== logChannel.id) {
      await applyJailRestriction(channel, jailRole.id);
    }
  }
  const existingGuide = (await jailChannel.messages.fetch({ limit: 50 })).find(
    (message) =>
      message.author.id === guild.client.user.id &&
      message.embeds.some((embed) => embed.title === "Guide du jail — à lire"),
  );
  const guidePayload = { embeds: [buildJailRoomEmbed()] };
  if (existingGuide) {
    await existingGuide.edit(guidePayload);
  } else {
    await jailChannel.send(guidePayload);
  }
  await logChannel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("Jail configuré")
        .setDescription(
          `Les salons jail sont prêts. Rôle brigade : ${brigade}. Rôle de restriction : ${jailRole}.`,
        ),
    ],
  });
  return setup;
}

export class JailCommandHandler {
  constructor(database) {
    this.database = database;
    this.managementStore = new ManagementStore(database.db);
    this.autoJailInFlight = new Set();
  }

  async handle(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Cette commande est utilisable uniquement dans un serveur.",
        ephemeral: true,
      });
      return;
    }
    const actor = await interaction.guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
    if (!actor) {
      await interaction.reply({
        content: "Je n’arrive pas à vérifier tes permissions.",
        ephemeral: true,
      });
      return;
    }
    const action = interaction.options.getSubcommand();
    const guild = interaction.guild;
    this.database.ensureGuild(guild.id);
    await interaction.deferReply({ ephemeral: true });
    try {
      const groupName = interaction.options.getSubcommandGroup(false);
      const key = ["jail", groupName, action].filter(Boolean).join(".");
      assertAccess(actor, this.managementStore.get(guild.id), key, JAIL_ACCESS[key] ?? 4);
      if (action === "setup") {
        const setup = await setupJail(guild, this.database);
        await interaction.editReply(
          `Configuration terminée : <#${setup.jailChannelId}> et <#${setup.logChannelId}>. Le propriétaire peut associer <@&${setup.brigadeRoleId}> au niveau Assistant avec /acces role.`,
        );
        return;
      }
      const settings = this.database.getSettings(guild.id);
      const group = interaction.options.getSubcommandGroup(false);
      if (action === "surveillance") {
        const enabled = interaction.options.getBoolean("activer", true);
        if (enabled) {
          this.database.allowMembershipMonitoring(guild.id, actor.id);
          await interaction.editReply(
            "Accord enregistré : les communautés qui ajoutent ce serveur à leur liste pourront jailer automatiquement les membres concernés à leur arrivée ici. Utilise `/jail surveillance activer:false` pour révoquer.",
          );
        } else {
          this.database.revokeMembershipMonitoring(guild.id);
          await interaction.editReply(
            "Accord révoqué. Les arrivées futures depuis ce serveur ne déclencheront plus de jail automatique.",
          );
        }
        return;
      }
      if (group === "serveurs") {
        await this.handleMonitoredGuilds(interaction, actor);
        return;
      }
      if (action === "etat") {
        const embed = buildJailGuide(settings);
        const monitored = this.database
          .getMonitoredGuilds(guild.id)
          .map((id) => {
            const monitoredGuild = interaction.client.guilds.cache.get(id);
            return monitoredGuild
              ? `• ${monitoredGuild.name} (\`${id}\`) — ${this.database.isMembershipMonitoringAllowed(id) ? "actif" : "accord révoqué"}`
              : `• serveur inaccessible (\`${id}\`) — inactif`;
          });
        embed.addFields({
          name: "Configuration actuelle",
          value: hasJailSetup(settings)
            ? `Brigade : <@&${settings.brigade_role_id}>\nJail : <@&${settings.jail_role_id}>\nSalon : <#${settings.jail_channel_id}>\nLogs : <#${settings.log_channel_id}>\nSurveillance autorisée ici : ${this.database.isMembershipMonitoringAllowed(guild.id) ? "oui" : "non"}\nServeurs suivis : ${monitored.length ? monitored.join("\n") : "aucun"}`
            : "Système non configuré. Un responsable doit lancer `/jail setup`.",
        });
        await interaction.editReply({ embeds: [embed] });
        return;
      }
      if (!hasJailSetup(settings)) {
        await interaction.editReply(
          "Le jail n’est pas configuré. Un responsable doit d’abord lancer `/jail setup`.",
        );
        return;
      }
      if (action === "mettre") {
        await this.jail(interaction, actor, settings);
      } else if (action === "liberer") {
        await this.unjail(interaction, actor, settings);
      }
    } catch (error) {
      console.error(`Jail command failed in guild ${guild.id}.`, error);
      await interaction.editReply(`Action impossible : ${error.message}`);
    }
  }

  async handleMonitoredGuilds(interaction, actor) {
    const guild = interaction.guild;
    const action = interaction.options.getSubcommand();
    if (action === "liste") {
      const guilds = this.database.getMonitoredGuilds(guild.id);
      await interaction.editReply(
        guilds.length
          ? `**Serveurs autorisés**\n${guilds
              .map((id) => {
                const target = interaction.client.guilds.cache.get(id);
                return `• ${target?.name ?? "inaccessible"} (\`${id}\`) — ${this.database.isMembershipMonitoringAllowed(id) ? "actif" : "accord révoqué"}`;
              })
              .join("\n")}`
          : "Aucun serveur autorisé.",
      );
      return;
    }
    const id = interaction.options.getString("id", true);
    if (!/^\d{15,22}$/.test(id) || id === guild.id) {
      await interaction.editReply("Indique l’ID valide d’un autre serveur.");
      return;
    }
    if (action === "retirer") {
      const removed = this.database.removeMonitoredGuild(guild.id, id);
      await interaction.editReply(
        removed
          ? `Le serveur \`${id}\` a été retiré.`
          : "Ce serveur n’était pas dans la liste.",
      );
      return;
    }
    if (!hasJailSetup(this.database.getSettings(guild.id))) {
      await interaction.editReply(
        "Configure d’abord le système avec `/jail setup` avant d’ajouter un serveur à surveiller.",
      );
      return;
    }
    const targetGuild = interaction.client.guilds.cache.get(id);
    if (!targetGuild) {
      await interaction.editReply(
        "Le bot n’est pas installé dans ce serveur, ou son accès est indisponible.",
      );
      return;
    }
    if (!this.database.isMembershipMonitoringAllowed(id)) {
      await interaction.editReply(
        "L’équipe dirigeante de ce serveur doit d’abord lancer `/jail surveillance activer` dans ce serveur.",
      );
      return;
    }
    this.database.addMonitoredGuild(guild.id, id, actor.id);
    await interaction.editReply(
      `**${targetGuild.name}** est ajouté. Le scan des membres actuels démarre; les correspondances seront jailées et le résultat apparaîtra dans <#${this.database.getSettings(guild.id).log_channel_id}>.`,
    );
    void this.scanMonitoredGuild(guild, targetGuild);
  }

  async scanMonitoredGuild(homeGuild, monitoredGuild) {
    const settings = this.database.getSettings(homeGuild.id);
    const stillAuthorized = () =>
      this.database.isMembershipMonitoringAllowed(monitoredGuild.id) &&
      this.database.getMonitoredGuilds(homeGuild.id).includes(monitoredGuild.id);
    try {
      const result = await scanGuildOverlap(
        homeGuild,
        monitoredGuild,
        (guild, member, sourceGuild) =>
          this.autoJail(guild, member, sourceGuild),
        stillAuthorized,
      );
      await homeGuild.channels.cache.get(settings.log_channel_id)?.send({
        embeds: [
          new EmbedBuilder()
            .setColor(result.failed ? 0xed4245 : 0x57f287)
            .setTitle(
              result.cancelled
                ? "Scan inter-serveurs interrompu"
                : "Scan inter-serveurs terminé",
            )
            .setDescription(
              `Serveur vérifié : ${monitoredGuild.name} (\`${monitoredGuild.id}\`)`,
            )
            .addFields(
              {
                name: "Membres parcourus",
                value: `${result.monitoredMembers}`,
                inline: true,
              },
              { name: "Correspondances", value: `${result.matches}`, inline: true },
              { name: "Jailés", value: `${result.jailed}`, inline: true },
              { name: "Ignorés", value: `${result.skipped}`, inline: true },
              { name: "Échecs", value: `${result.failed}`, inline: true },
            )
            .setTimestamp(),
        ],
      });
    } catch (error) {
      console.error(
        `Scan inter-serveurs impossible (${homeGuild.id}, ${monitoredGuild.id}).`,
        error,
      );
      await homeGuild.channels.cache.get(settings.log_channel_id)?.send({
        content: `Le scan de **${monitoredGuild.name}** a échoué. Vérifie l’intention Server Members, les accès du bot et les logs d’hébergement.`,
      }).catch((logError) => {
        console.error("Impossible d’annoncer l’échec du scan.", logError);
      });
    }
  }

  async jail(interaction, actor, settings) {
    const user = interaction.options.getUser(MEMBER_NAME);
    const target = await interaction.guild.members.fetch({ user: user.id, force: true }).catch(() => null);
    if (
      !target ||
      target.id === interaction.guild.ownerId ||
      target.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      await interaction.editReply("Ce membre ne peut pas être placé en jail.");
      return;
    }
    if (
      target.roles.highest.position >= actor.roles.highest.position &&
      interaction.guild.ownerId !== actor.id
    ) {
      await interaction.editReply(
        "Tu ne peux pas jailer un membre ayant un rôle égal ou supérieur au tien.",
      );
      return;
    }
    const jailRole = interaction.guild.roles.cache.get(settings.jail_role_id);
    const botMember =
      interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());
    assertTarget(actor, target, botMember, this.managementStore.get(interaction.guild.id));
    if (
      !jailRole ||
      jailRole.position >= botMember.roles.highest.position ||
      !botMember.permissions.has(PermissionFlagsBits.ManageRoles)
    ) {
      await interaction.editReply(
        "Le rôle Jail doit exister sous le rôle du bot, et le bot doit avoir Gérer les rôles.",
      );
      return;
    }
    const reason = interaction.options.getString("raison", true);
    await target.roles.add(jailRole, `Jail par ${interaction.user.tag}: ${reason}`);
    this.database.addJail(interaction.guild.id, target.id, reason, actor.id);
    const logs = interaction.guild.channels.cache.get(settings.log_channel_id);
    await logs?.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("Mise en jail")
          .setThumbnail(target.displayAvatarURL({ size: 256 }))
          .addFields(
            { name: "Membre", value: `${target} (\`${target.id}\`)`, inline: true },
            { name: "Agent", value: `${actor}`, inline: true },
            { name: "Motif", value: reason },
          )
          .setTimestamp(),
      ],
    });
    await interaction.editReply(`${target.user.tag} a été placé en jail.`);
  }

  async autoJail(guild, target, monitoredGuild) {
    const lock = `${guild.id}:${target.id}`;
    if (this.autoJailInFlight.has(lock)) return false;
    this.autoJailInFlight.add(lock);
    try {
      return await this.applyAutoJail(guild, target, monitoredGuild);
    } finally {
      this.autoJailInFlight.delete(lock);
    }
  }

  async applyAutoJail(guild, target, monitoredGuild) {
    const settings = this.database.getSettings(guild.id);
    if (!hasJailSetup(settings) || !this.database.isMembershipMonitoringAllowed(monitoredGuild.id)) {
      return false;
    }
    if (this.database.getJail(guild.id, target.id)) return false;
    const role = guild.roles.cache.get(settings.jail_role_id);
    const botMember = guild.members.me ?? (await guild.members.fetchMe());
    if (
      !role ||
      target.id === guild.ownerId ||
      target.permissions.has(PermissionFlagsBits.Administrator) ||
      memberLevel(target, this.managementStore.get(guild.id)) > 0 ||
      target.roles.highest.comparePositionTo(botMember.roles.highest) >= 0 ||
      role.position >= botMember.roles.highest.position
    ) {
      return false;
    }
    const reason = `Présence détectée dans le serveur autorisé « ${monitoredGuild.name} » (${monitoredGuild.id}).`;
    await target.roles.add(role, `Jail automatique: ${reason}`);
    this.database.addJail(guild.id, target.id, reason, botMember.id);
    const logs = guild.channels.cache.get(settings.log_channel_id);
    await logs?.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("Jail automatique — arrivée détectée")
          .setThumbnail(target.displayAvatarURL({ size: 256 }))
          .addFields(
            { name: "Membre", value: `${target} (\`${target.id}\`)`, inline: true },
            { name: "Serveur autorisé", value: `${monitoredGuild.name} (\`${monitoredGuild.id}\`)` },
          )
          .setTimestamp(),
      ],
    }).catch((error) => {
      console.error(`Jail effectué, mais log impossible (${target.id}).`, error);
    });
    await target.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("Mise en jail automatique")
          .setDescription(
            `Tu as été placé en jail dans **${guild.name}** après détection de ta présence dans un serveur surveillé. Motif : ${reason}`,
          )
          .addFields({
            name: "Contester ou demander une explication",
            value: `Contacte la brigade dans <#${settings.jail_channel_id}> du serveur **${guild.name}**.`,
          }),
      ],
    }).catch(() => {
      console.info(`DM de notification impossible pour ${target.id}.`);
    });
    return true;
  }

  async unjail(interaction, actor, settings) {
    const user = interaction.options.getUser(MEMBER_NAME);
    const target = await interaction.guild.members.fetch({ user: user.id, force: true }).catch(() => null);
    const jailRole = interaction.guild.roles.cache.get(settings.jail_role_id);
    if (!target || !jailRole || !target.roles.cache.has(jailRole.id)) {
      await interaction.editReply("Ce membre n’est pas jailé.");
      return;
    }
    const botMember =
      interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());
    assertTarget(actor, target, botMember, this.managementStore.get(interaction.guild.id));
    if (jailRole.position >= botMember.roles.highest.position) {
      await interaction.editReply("Place le rôle du bot au-dessus du rôle Jail.");
      return;
    }
    await target.roles.remove(jailRole, `Libération par ${interaction.user.tag}.`);
    const progress = this.database.removeJailAndPromote(
      interaction.guild.id,
      target.id,
      settings.rank_role_ids.length,
    );
    let rankNotice = "Aucun rang attribué : dossier de jail introuvable.";
    if (progress) {
      const rankId =
        progress.rank_level > 0
          ? settings.rank_role_ids[progress.rank_level - 1]
          : null;
      const currentRank = rankId
        ? interaction.guild.roles.cache.get(rankId)
        : null;
      const priorRanks = settings.rank_role_ids
        .map((id) => interaction.guild.roles.cache.get(id))
        .filter(
          (role) =>
            role &&
            role.id !== currentRank?.id &&
            target.roles.cache.has(role.id),
        );
      if (priorRanks.length) {
        await target.roles.remove(
          priorRanks,
          "Remplacement du rang précédent après libération.",
        );
      }
      if (currentRank && currentRank.position < botMember.roles.highest.position) {
        await target.roles.add(currentRank, "Progression après une libération.");
        rankNotice = `Nouveau rang : ${currentRank}.`;
      } else if (currentRank) {
        rankNotice =
          "Le rang a été comptabilisé, mais sa position empêche son attribution. Vérifie la hiérarchie des rôles.";
      } else {
        rankNotice =
          `Libérations enregistrées : ${progress.unjail_count}. Le rôle de rang n’existe plus.`;
      }
    }
    const logs = interaction.guild.channels.cache.get(settings.log_channel_id);
    await logs?.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle("Libération du jail")
          .setThumbnail(target.displayAvatarURL({ size: 256 }))
          .addFields(
            { name: "Membre", value: `${target} (\`${target.id}\`)`, inline: true },
            { name: "Agent", value: `${actor}`, inline: true },
            { name: "Progression", value: rankNotice },
          )
          .setTimestamp(),
      ],
    });
    await interaction.editReply(`${target.user.tag} a été libéré. ${rankNotice}`);
  }
}
