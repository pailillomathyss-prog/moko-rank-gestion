import {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
} from "discord.js";

export function createLogPanel(guild, settings) {
  const channel = settings.rankLogChannelId
    ? guild.channels.cache.get(settings.rankLogChannelId)
    : null;
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId("moko:logs:channel")
    .setPlaceholder("Choisis le salon des annonces de rang")
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(1)
    .setMaxValues(1);

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x8b5cf6)
        .setTitle("Moko Rank • Salon des annonces")
        .setDescription(
          "Les changements de palier et les passages du panneau de test seront annoncés ici, avec l’avatar du membre."
        )
        .addFields({
          name: "Salon sélectionné",
          value: channel ? `<#${channel.id}>` : "Aucun salon sélectionné",
        }),
    ],
    components: [new ActionRowBuilder().addComponents(menu)],
    allowedMentions: { parse: [] },
  };
}
