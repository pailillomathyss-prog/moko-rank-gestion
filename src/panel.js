import {
  ActionRowBuilder,
  EmbedBuilder,
  RoleSelectMenuBuilder,
} from "discord.js";
import { RANKS, formatCount } from "./ranks.js";

export function createRolePanel(guild, settings) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Configuration des rôles de rang")
    .setDescription(
      "Choisis un rôle pour chaque palier avec les menus ci-dessous. " +
        "Les deux quotas doivent être atteints pendant le même cycle."
    );

  for (const rank of RANKS) {
    const roleId = settings.roleIds[rank.level - 1];
    const role = roleId ? guild.roles.cache.get(roleId) : null;
    embed.addFields({
      name: `Palier ${rank.level}`,
      value:
        `${formatCount(rank.messages)} messages et ${rank.voiceHours} h de vocal\n` +
        `Rôle : ${role ? `<@&${role.id}>` : "Non configuré"}`,
      inline: false,
    });
  }

  const components = RANKS.map((rank) =>
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`moko:rank-role:${rank.level}`)
        .setPlaceholder(`Choisir le rôle du palier ${rank.level}`)
        .setMinValues(1)
        .setMaxValues(1)
    )
  );

  return {
    embeds: [embed],
    components,
    allowedMentions: { parse: [] },
  };
}
