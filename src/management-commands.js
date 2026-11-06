import { ChannelType, SlashCommandBuilder } from "discord.js";

// A single registry drives registration, authorization and help.
// Options: type, name, description, required, minimum, maximum.
const user = ["User", "membre", "Membre concerné", true];
const reason = ["String", "raison", "Motif de l’action", true];
const channel = ["Channel", "salon", "Salon concerné", true];
const role = ["Role", "role", "Rôle ordinaire concerné", true];
const name = ["String", "nom", "Nouveau nom", true];
const confirm = ["Boolean", "confirmer", "Vrai pour confirmer cette action irréversible", true];
export const ACTIONS = [
  ["info", "serveur", 0, "Informations sur le serveur", []],
  ["info", "membre", 0, "Informations publiques sur un membre", [user]],
  ["info", "role", 0, "Informations sur un rôle", [role]],
  ["info", "salon", 0, "Informations sur un salon visible", [channel]],
  ["info", "ping", 0, "Latence de connexion du bot", []],
  ["moderation", "avertir", 1, "Enregistre un avertissement", [user, reason]],
  ["moderation", "avertissements", 1, "Liste les 15 derniers avertissements actifs", [user]],
  ["moderation", "historique", 2, "Liste les 15 dernières actions sur un membre", [user]],
  ["moderation", "retirer-avertissement", 2, "Retire un avertissement par numéro", [user, ["Integer", "numero", "Numéro du dossier", true, 1], reason]],
  ["moderation", "timeout", 2, "Exclut temporairement un membre", [user, ["Integer", "minutes", "Durée en minutes (maximum 28 jours)", true, 1, 40320], reason]],
  ["moderation", "untimeout", 2, "Retire une exclusion temporaire", [user, reason]],
  ["moderation", "expulser", 2, "Expulse un membre du serveur", [user, reason, confirm]],
  ["moderation", "bannir", 3, "Bannit un membre présent sur le serveur", [user, reason, confirm]],
  ["moderation", "debannir", 3, "Débannit un utilisateur par ID", [["String", "id", "ID Discord de l’utilisateur banni", true], reason]],
  ["moderation", "bannissements", 3, "Liste jusqu’à 15 bannissements", []],
  ["moderation", "surnom", 2, "Modifie le surnom d’un membre", [user, ["String", "nom", "Nouveau surnom (32 caractères)", true], reason]],
  ["moderation", "reset-surnom", 2, "Retire le surnom d’un membre", [user, reason]],
  ["messages", "nettoyer", 2, "Supprime jusqu’à 100 messages récents", [channel, ["Integer", "nombre", "Nombre de messages (moins de 14 jours)", true, 1, 100], confirm]],
  ["messages", "annoncer", 3, "Publie une annonce sans ping", [channel, ["String", "texte", "Texte à publier", true]]],
  ["messages", "epingler", 2, "Épingle un message", [channel, ["String", "id", "ID du message", true]]],
  ["messages", "desepingler", 2, "Retire une épingle", [channel, ["String", "id", "ID du message", true]]],
  ["salons", "creer-texte", 3, "Crée un salon textuel", [name]],
  ["salons", "creer-vocal", 3, "Crée un salon vocal", [name]],
  ["salons", "creer-categorie", 3, "Crée une catégorie", [name]],
  ["salons", "renommer", 3, "Renomme un salon", [channel, name]],
  ["salons", "sujet", 3, "Modifie le sujet d’un salon texte", [channel, ["String", "texte", "Nouveau sujet", true]]],
  ["salons", "ralentir", 2, "Configure le mode lent", [channel, ["Integer", "secondes", "0 pour désactiver, maximum 21600", true, 0, 21600]]],
  ["salons", "verrouiller", 2, "Bloque l’écriture pour @everyone", [channel]],
  ["salons", "deverrouiller", 2, "Restaure les droits précédant le verrouillage", [channel]],
  ["salons", "deplacer", 3, "Déplace un salon sans synchroniser ses droits", [channel, ["Channel", "categorie", "Catégorie de destination", true]]],
  ["salons", "limite-vocale", 3, "Configure la capacité d’un salon vocal", [channel, ["Integer", "nombre", "0 pour illimité, maximum 99", true, 0, 99]]],
  ["salons", "supprimer", 3, "Supprime définitivement un salon vide de dépendances", [channel, confirm]],
  ["roles", "creer", 3, "Crée un rôle sans permissions", [name]],
  ["roles", "renommer", 3, "Renomme un rôle ordinaire", [role, name]],
  ["roles", "couleur", 3, "Change la couleur d’un rôle ordinaire", [role, ["String", "hex", "Couleur au format #RRGGBB", true]]],
  ["roles", "donner", 3, "Donne un rôle ordinaire à un membre", [user, role, reason]],
  ["roles", "retirer", 3, "Retire un rôle ordinaire à un membre", [user, role, reason]],
  ["roles", "supprimer", 3, "Supprime définitivement un rôle ordinaire", [role, confirm]],
  ["vocal", "deplacer", 2, "Déplace un membre connecté en vocal", [user, channel, reason]],
  ["vocal", "deconnecter", 2, "Déconnecte un membre du vocal", [user, reason]],
  ["vocal", "muet", 2, "Active ou désactive le mute serveur", [user, ["Boolean", "activer", "Activer le mute serveur", true], reason]],
  ["vocal", "sourd", 2, "Active ou désactive la sourdine serveur", [user, ["Boolean", "activer", "Activer la sourdine serveur", true], reason]],
];
export const JAIL_ACCESS = {
  "jail.setup": 3, "jail.mettre": 1, "jail.liberer": 1, "jail.etat": 0,
  "jail.surveillance": 3, "jail.serveurs.ajouter": 3,
  "jail.serveurs.retirer": 3, "jail.serveurs.liste": 3,
};
export const commandLevels = Object.fromEntries([
  ...ACTIONS.map(([group, action, level]) => [`${group}.${action}`, level]),
  ...Object.entries(JAIL_ACCESS),
]);

function addOption(sub, [type, optionName, description, required, min, max]) {
  sub[`add${type}Option`]((option) => {
    option.setName(optionName).setDescription(description).setRequired(required);
    if (type === "String") option.setMaxLength(optionName === "nom" ? 100 : optionName === "texte" ? 1000 : 400);
    if (min !== undefined) option.setMinValue(min);
    if (max !== undefined) option.setMaxValue(max);
    if (optionName === "categorie") option.addChannelTypes(ChannelType.GuildCategory);
    return option;
  });
}
const gestion = new SlashCommandBuilder().setName("gestion").setDescription("Gestion du serveur selon ton niveau.").setDMPermission(false);
for (const group of new Set(ACTIONS.map(([group]) => group))) {
  gestion.addSubcommandGroup((builder) => {
    builder.setName(group).setDescription(`Commandes ${group}`);
    for (const [, action, , description, options] of ACTIONS.filter(([g]) => g === group)) {
      builder.addSubcommand((sub) => {
        sub.setName(action).setDescription(description);
        for (const option of options) addOption(sub, option);
        return sub;
      });
    }
    return builder;
  });
}
const acces = new SlashCommandBuilder().setName("acces").setDescription("Configuration des accès par le propriétaire.").setDMPermission(false);
for (const [action, description, options] of [
  ["voir", "Affiche les niveaux et les rôles associés", []],
  ["role", "Associe un rôle à un niveau (0 retire l’association)", [role, ["Integer", "niveau", "1 Assistant, 2 Modérateur, 3 Administrateur, 0 Retirer", true, 0, 3]]],
  ["commande", "Relève le niveau requis d’une commande", [["String", "commande", "Clé affichée dans /aide, par exemple moderation.timeout", true], ["Integer", "niveau", "Niveau minimal (sans descendre sous le niveau de sécurité)", true, 0, 4]]],
  ["reinitialiser-commande", "Rétablit le niveau initial d’une commande", [["String", "commande", "Clé de commande affichée dans /aide", true]]],
  ["logs", "Choisit le salon de journalisation des actions", [channel]],
  ["desactiver-logs", "Désactive le salon de logs (historique conservé)", []],
]) {
  acces.addSubcommand((sub) => {
    sub.setName(action).setDescription(description);
    options.forEach((option) => addOption(sub, option));
    return sub;
  });
}
const aide = new SlashCommandBuilder().setName("aide").setDescription("Commandes classées par niveau et accès personnel.").setDMPermission(false);
export const managementCommands = [gestion, acces, aide];
