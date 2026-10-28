import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { RANKS, formatCount } from "./ranks.js";

export function createTestPanel(guild, settings) {
  const embed = new EmbedBuilder()
    .setColor(0xe5a43c)
    .setTitle("Test d’attribution des rôles")
    .setDescription(
      "Démarre le test, puis envoie un message normal dans ce salon pour " +
        "passer au palier suivant. Le vocal et les vrais compteurs sont " +
        "ignorés pendant le test. Tes rôles précédents seront restaurés à la " +
        "fin ; le test s’arrête après 10 minutes d’inactivité."
    );

  for (const rank of RANKS) {
    const roleId = settings.roleIds[rank.level - 1];
    const role = roleId ? guild.roles.cache.get(roleId) : null;
    embed.addFields({
      name: `Palier ${rank.level} — ${formatCount(rank.messages)} messages`,
      value: `Rôle de test : ${role ? `<@&${role.id}>` : "Non configuré"}`,
      inline: true,
    });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("moko:test:start")
      .setLabel("Démarrer le test")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("moko:test:stop")
      .setLabel("Terminer et restaurer")
      .setStyle(ButtonStyle.Danger)
  );

  return {
    embeds: [embed],
    components: [row],
    allowedMentions: { parse: [] },
  };
}
