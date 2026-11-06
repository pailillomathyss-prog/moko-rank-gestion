import { PermissionFlagsBits as P } from "discord.js";

export const LEVELS = ["Membre", "Assistant", "Modérateur", "Administrateur", "Propriétaire"];

export function memberLevel(member, config) {
  if (member.id === member.guild.ownerId) return 4;
  let level = 0;
  for (const [roleId, assigned] of Object.entries(config.roles)) {
    if (member.roles.cache.has(roleId)) level = Math.max(level, Math.min(3, assigned));
  }
  return level;
}

export function requiredLevel(config, key, minimum) {
  return Math.max(minimum, config.commands[key] ?? minimum);
}

export function assertAccess(member, config, key, minimum) {
  if (memberLevel(member, config) < requiredLevel(config, key, minimum)) {
    throw new Error(`Commande réservée au niveau ${LEVELS[requiredLevel(config, key, minimum)]} ou supérieur.`);
  }
}

export function assertTarget(actor, target, bot, config) {
  if (!target || target.id === actor.id || target.id === actor.guild.ownerId || target.id === bot.id) {
    throw new Error("Cible absente ou protégée (toi-même, propriétaire ou bot).");
  }
  if (target.roles.highest.comparePositionTo(bot.roles.highest) >= 0) {
    throw new Error("Le rôle du bot doit être au-dessus de celui du membre.");
  }
  if (actor.id !== actor.guild.ownerId &&
      (target.roles.highest.comparePositionTo(actor.roles.highest) >= 0 ||
       memberLevel(target, config) >= memberLevel(actor, config))) {
    throw new Error("Ce membre a un rôle ou un niveau de gestion égal ou supérieur au tien.");
  }
}

export function assertRole(actor, role, bot, config, jailSettings) {
  const reserved = [jailSettings.brigade_role_id, jailSettings.jail_role_id, ...jailSettings.rank_role_ids];
  if (!role || role.id === actor.guild.id || role.managed || reserved.includes(role.id) ||
      config.roles[role.id] || role.permissions.bitfield !== 0n) {
    throw new Error("Seuls les rôles ordinaires sans permissions peuvent être gérés ici. Rôles système, Jail et d’accès protégés.");
  }
  if (role.comparePositionTo(bot.roles.highest) >= 0 ||
      (actor.id !== actor.guild.ownerId && role.comparePositionTo(actor.roles.highest) >= 0)) {
    throw new Error("Ce rôle est trop haut dans la hiérarchie.");
  }
}

export function assertBotPermission(bot, permission, channel = null) {
  const permissions = channel ? channel.permissionsFor(bot) : bot.permissions;
  if (!permissions?.has(P[permission])) throw new Error(`Permission manquante pour le bot : ${permission}.`);
}
