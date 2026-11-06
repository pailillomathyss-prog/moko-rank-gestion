import { EmbedBuilder } from "discord.js";
import { formatCount } from "./ranks.js";

export function createRankAnnouncement(member, rank, role, { isTest = false } = {}) {
  const avatarUrl = member.user.displayAvatarURL({ size: 256 });
  const title = isTest
    ? `🧪 Test de rang — palier ${rank.level}`
    : `🏆 Nouveau palier : ${rank.level}`;

  return {
    content: isTest
      ? `🧪 <@${member.id}> vient de tester le palier ${rank.level}.`
      : `🎉 <@${member.id}> vient d’atteindre le palier ${rank.level} !`,
    embeds: [
      new EmbedBuilder()
        .setColor(isTest ? 0xe5a43c : 0x8b5cf6)
        .setAuthor({
          name: "Moko Rank • Progression",
          iconURL: avatarUrl,
        })
        .setTitle(title)
        .setDescription(
          isTest
            ? "Ce rang a été attribué temporairement par le panneau de test."
            : "Félicitations pour ce nouveau rang !"
        )
        .setThumbnail(avatarUrl)
        .addFields(
          {
            name: "Membre",
            value: `${member} · ${member.displayName}`,
            inline: true,
          },
          {
            name: "Rôle",
            value: role ? `<@&${role.id}>` : `Palier ${rank.level}`,
            inline: true,
          },
          {
            name: "Quota du palier",
            value: `${formatCount(rank.messages)} messages\n${rank.voiceHours} h de vocal`,
            inline: true,
          }
        )
        .setTimestamp(),
    ],
    allowedMentions: { users: [member.id], roles: [] },
  };
}
