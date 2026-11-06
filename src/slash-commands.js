import {
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

const requiredText = (option, name, description, maxLength = 400) =>
  option
    .setName(name)
    .setDescription(description)
    .setRequired(true)
    .setMaxLength(maxLength);

const optionalText = (option, name, description, maxLength = 400) =>
  option
    .setName(name)
    .setDescription(description)
    .setRequired(false)
    .setMaxLength(maxLength);

const memberOption = (option) =>
  option
    .setName("membre")
    .setDescription("Membre concerné")
    .setRequired(true);

const reasonOption = (option) =>
  optionalText(option, "raison", "Motif de l’action.", 400);

const commands = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Affiche le guide complet des commandes Moko Rank."),
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Affiche les quotas et le niveau d’un membre.")
    .addUserOption((o) =>
      o.setName("membre").setDescription("Membre à consulter").setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Configure les rôles des cinq niveaux.")
    .addIntegerOption((o) =>
      o
        .setName("retirer")
        .setDescription("Numéro du niveau dont retirer le rôle.")
        .setMinValue(1)
        .setMaxValue(5)
        .setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  new SlashCommandBuilder()
    .setName("testpanel")
    .setDescription("Ouvre le test temporaire d’attribution des niveaux.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  new SlashCommandBuilder()
    .setName("logpanel")
    .setDescription("Choisit le salon des annonces de niveau.")
    .addBooleanOption((o) =>
      o.setName("desactiver").setDescription("Désactive les annonces").setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Lance un tirage au sort.")
    .addStringOption((o) => requiredText(o, "duree", "Exemple : 2h ou 30m.", 20))
    .addIntegerOption((o) =>
      o.setName("gagnants").setDescription("Nombre de gagnants").setMinValue(1).setMaxValue(20).setRequired(true),
    )
    .addStringOption((o) => requiredText(o, "lot", "Description du lot.", 200))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Expulse un membre.")
    .addUserOption(memberOption)
    .addStringOption(reasonOption),
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Bannit un membre.")
    .addUserOption(memberOption)
    .addStringOption(reasonOption),
  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Lève le bannissement d’un ID Discord.")
    .addStringOption((o) => requiredText(o, "id", "ID Discord de la personne.", 22))
    .addStringOption(reasonOption),
  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Place un membre en timeout.")
    .addUserOption(memberOption)
    .addStringOption((o) => requiredText(o, "duree", "Exemple : 10m, 2h ou 1d.", 20))
    .addStringOption(reasonOption),
  new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("Retire le timeout d’un membre.")
    .addUserOption(memberOption)
    .addStringOption(reasonOption),
  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Supprime entre 1 et 100 messages récents.")
    .addIntegerOption((o) =>
      o.setName("nombre").setDescription("Nombre de messages").setMinValue(1).setMaxValue(100).setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Ajoute un avertissement à un membre.")
    .addUserOption(memberOption)
    .addStringOption(reasonOption),
  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("Affiche les avertissements d’un membre.")
    .addUserOption(memberOption),
  new SlashCommandBuilder()
    .setName("clearwarnings")
    .setDescription("Efface les avertissements d’un membre.")
    .addUserOption(memberOption),
  new SlashCommandBuilder()
    .setName("staff")
    .setDescription("Configure et gère le rôle staff.")
    .addSubcommand((s) =>
      s.addRoleOption((o) => o.setName("role").setDescription("Rôle staff").setRequired(true))
        .setName("role")
        .setDescription("Configure le rôle staff."),
    )
    .addSubcommand((s) =>
      s.addUserOption((o) => o.setName("membre").setDescription("Membre à ajouter").setRequired(true))
        .setName("ajouter")
        .setDescription("Ajoute un membre au staff."),
    )
    .addSubcommand((s) =>
      s.addUserOption((o) => o.setName("membre").setDescription("Membre à retirer").setRequired(true))
        .setName("retirer")
        .setDescription("Retire un membre du staff."),
    )
    .addSubcommand((s) => s.setName("liste").setDescription("Affiche les membres staff.")),
  new SlashCommandBuilder()
    .setName("gbl")
    .setDescription("Gère la liste noire globale du bot.")
    .addSubcommand((s) =>
      s.addStringOption((o) => requiredText(o, "id", "ID Discord de la personne.", 22))
        .addBooleanOption((o) => o.setName("confirmer").setDescription("Confirme le bannissement global").setRequired(true))
        .addStringOption(reasonOption)
        .setName("ban")
        .setDescription("Bannit cet ID dans les serveurs accessibles au bot."),
    )
    .addSubcommand((s) =>
      s.addStringOption((o) => requiredText(o, "id", "ID Discord de la personne.", 22))
        .setName("retirer")
        .setDescription("Retire un ID de la liste noire globale."),
    )
    .addSubcommand((s) => s.setName("liste").setDescription("Affiche la liste noire globale.")),
  new SlashCommandBuilder()
    .setName("owner")
    .setDescription("Commandes réservées au propriétaire du bot.")
    .addSubcommand((s) => s.setName("stats").setDescription("Affiche les statistiques globales du bot."))
    .addSubcommand((s) => s.setName("serveurs").setDescription("Liste les serveurs du bot.")),
  new SlashCommandBuilder()
    .setName("brigade")
    .setDescription("Configure la brigade et les protections du serveur.")
    .addSubcommand((s) =>
      s.addRoleOption((o) => o.setName("role").setDescription("Rôle de la brigade").setRequired(true))
        .setName("role")
        .setDescription("Configure le rôle autorisé à gérer la sécurité."),
    )
    .addSubcommand((s) =>
      s.addRoleOption((o) => o.setName("role").setDescription("Rôle de jail").setRequired(true))
        .addChannelOption((o) => o.setName("salon").setDescription("Salon de jail").setRequired(true))
        .setName("jail")
        .setDescription("Configure le rôle et le salon de jail."),
    )
    .addSubcommand((s) =>
      s.addRoleOption((o) => o.setName("role").setDescription("Rôle à donner après validation").setRequired(true))
        .setName("role_sortie")
        .setDescription("Configure le rôle de sortie du jail."),
    )
    .addSubcommand((s) =>
      s.addBooleanOption((o) => o.setName("actif").setDescription("Active ou désactive l’anti-raid").setRequired(true))
        .setName("raid")
        .setDescription("Active ou désactive l’anti-raid."),
    )
    .addSubcommand((s) =>
      s.addIntegerOption((o) => o.setName("arrivees").setDescription("Seuil d’arrivées").setMinValue(3).setMaxValue(50).setRequired(true))
        .addIntegerOption((o) => o.setName("secondes").setDescription("Fenêtre en secondes").setMinValue(5).setMaxValue(120).setRequired(true))
        .setName("seuil")
        .setDescription("Règle le seuil anti-raid."),
    ),
  new SlashCommandBuilder()
    .setName("enemy")
    .setDescription("Gère la liste manuelle des IDs ennemis.")
    .addSubcommand((s) =>
      s.addStringOption((o) => requiredText(o, "id", "ID Discord à surveiller.", 22))
        .addStringOption(reasonOption)
        .setName("ajouter")
        .setDescription("Ajoute un ID à jailer à son arrivée."),
    )
    .addSubcommand((s) =>
      s.addStringOption((o) => requiredText(o, "id", "ID Discord à retirer.", 22))
        .setName("retirer")
        .setDescription("Retire un ID de la liste."),
    )
    .addSubcommand((s) => s.setName("liste").setDescription("Affiche la liste manuelle.")),
  new SlashCommandBuilder()
    .setName("jail")
    .setDescription("Place un membre en jail.")
    .addUserOption(memberOption)
    .addStringOption(reasonOption),
  new SlashCommandBuilder()
    .setName("unjail")
    .setDescription("Libère un membre du jail.")
    .addUserOption(memberOption),
  new SlashCommandBuilder()
    .setName("security")
    .setDescription("Affiche l’état des réglages de sécurité."),
  new SlashCommandBuilder()
    .setName("quitter")
    .setDescription("Demande à la brigade une vérification de sortie du jail."),
  new SlashCommandBuilder()
    .setName("quitterlist")
    .setDescription("Affiche les demandes de sortie en attente."),
  new SlashCommandBuilder()
    .setName("quittervalider")
    .setDescription("Valide une demande, donne le rôle de sortie et libère le membre.")
    .addUserOption(memberOption),
  new SlashCommandBuilder()
    .setName("quitterrefuser")
    .setDescription("Refuse une demande de sortie du jail.")
    .addUserOption(memberOption)
    .addStringOption(reasonOption),
];

export const SLASH_COMMANDS = commands.map((command) => command.toJSON());

export function parseSlashInvocation(interaction) {
  const { commandName, options } = interaction;
  const getSub = () => options.getSubcommand(false);
  const getString = (name) => options.getString(name);
  const getInteger = (name) => options.getInteger(name);
  const getBoolean = (name) => options.getBoolean(name);
  const getUser = (name = "membre") => options.getUser(name);
  const getRole = (name = "role") => options.getRole(name);
  const getChannel = (name = "salon") => options.getChannel(name);
  const target = getUser();
  const reason = getString("raison");
  let command = commandName;
  let args = [];
  let member = target
    ? interaction.guild.members.cache.get(target.id) ?? null
    : null;
  let role = null;
  let channel = null;
  let user = null;

  switch (commandName) {
    case "help":
    case "testpanel":
    case "security":
    case "quitter":
    case "quitterlist":
      break;
    case "stats":
      args = target ? [target.id] : [];
      break;
    case "panel": {
      const removeLevel = getInteger("retirer");
      args = removeLevel ? ["retirer", String(removeLevel)] : [];
      break;
    }
    case "logpanel":
      args = getBoolean("desactiver") ? ["off"] : [];
      break;
    case "giveaway":
      args = [getString("duree"), String(getInteger("gagnants")), getString("lot")];
      break;
    case "kick":
    case "ban":
    case "warn":
    case "warnings":
    case "clearwarnings":
    case "unjail":
    case "jail":
      args = target ? [target.id, ...(reason ? [reason] : [])] : [];
      break;
    case "untimeout":
      args = target ? [target.id, ...(reason ? [reason] : [])] : [];
      break;
    case "timeout":
      args = target
        ? [target.id, getString("duree"), ...(reason ? [reason] : [])]
        : [];
      break;
    case "clear":
      args = [String(getInteger("nombre"))];
      break;
    case "unban":
      args = [getString("id"), ...(reason ? [reason] : [])];
      break;
    case "staff": {
      const sub = getSub();
      command = "staff";
      if (sub === "role") {
        role = getRole();
        args = ["role"];
      } else if (sub === "ajouter" || sub === "retirer") {
        member = getUser("membre")
          ? interaction.guild.members.cache.get(getUser("membre").id) ?? null
          : null;
        args = [sub === "ajouter" ? "add" : "remove", member?.id ?? ""];
      } else {
        args = ["list"];
      }
      break;
    }
    case "gbl": {
      const sub = getSub();
      command = "gbl";
      if (sub === "ban") {
        args = [
          "ban",
          getString("id"),
          getBoolean("confirmer") ? "confirmer" : "",
          ...(reason ? [reason] : []),
        ];
      } else {
        args = [sub === "retirer" ? "remove" : "list", ...(sub === "retirer" ? [getString("id")] : [])];
      }
      break;
    }
    case "owner":
      args = [getSub() === "serveurs" ? "guilds" : "stats"];
      break;
    case "brigade": {
      const sub = getSub();
      command = "brigade";
      if (sub === "role" || sub === "role_sortie") {
        role = getRole();
        args = [sub === "role" ? "role" : "quitterole"];
      } else if (sub === "jail") {
        role = getRole();
        channel = getChannel();
        args = ["jailrole"];
      } else if (sub === "raid") {
        args = ["raid", getBoolean("actif") ? "on" : "off"];
      } else {
        args = ["seuil", String(getInteger("arrivees")), String(getInteger("secondes"))];
      }
      break;
    }
    case "enemy": {
      const sub = getSub();
      command = "enemy";
      if (sub === "ajouter") {
        args = ["add", getString("id"), ...(reason ? [reason] : [])];
      } else if (sub === "retirer") {
        args = ["remove", getString("id")];
      } else {
        args = ["list"];
      }
      break;
    }
    case "quittervalider":
    case "quitterrefuser":
      member = target ? interaction.guild.members.cache.get(target.id) ?? null : null;
      args = member ? [member.id, ...(reason ? [reason] : [])] : [];
      break;
    default:
      break;
  }

  if (commandName === "clear") {
    // clear is already represented as a normal prefix command with an integer argument.
  }
  if (commandName === "unban") user = getString("id");

  return {
    command,
    args,
    member,
    role,
    channel,
    user,
  };
}
