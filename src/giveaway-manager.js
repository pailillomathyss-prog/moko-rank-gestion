import { randomInt, randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";

const MAX_GIVEAWAY_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
const GIVEAWAY_BUTTON_PREFIX = "moko:giveaway:enter:";

export function parseGiveawayArguments(args) {
  const [durationInput, winnerInput, ...prizeParts] = args;
  const durationMatch = /^([1-9]\d*)([smhd])$/i.exec(durationInput ?? "");
  if (!durationMatch) {
    throw new Error("Indique une durée valide, par exemple `30m`, `2h` ou `1d`.");
  }

  const durationUnits = {
    s: 1_000,
    m: 60_000,
    h: 60 * 60_000,
    d: 24 * 60 * 60_000,
  };
  const durationMs =
    Number(durationMatch[1]) * durationUnits[durationMatch[2].toLowerCase()];
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs < 10_000 ||
    durationMs > MAX_GIVEAWAY_DURATION_MS
  ) {
    throw new Error("La durée doit être comprise entre 10 secondes et 30 jours.");
  }

  const winnerCount = Number(winnerInput);
  if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 20) {
    throw new Error("Le nombre de gagnants doit être compris entre 1 et 20.");
  }

  const prize = prizeParts.join(" ").trim();
  if (!prize || prize.length > 150) {
    throw new Error("Indique un lot de 1 à 150 caractères.");
  }

  return { durationMs, winnerCount, prize };
}

function chooseWinners(entries, winnerCount) {
  const pool = [...entries];
  const count = Math.min(pool.length, winnerCount);
  for (let index = 0; index < count; index += 1) {
    const selectedIndex = index + randomInt(pool.length - index);
    [pool[index], pool[selectedIndex]] = [pool[selectedIndex], pool[index]];
  }
  return pool.slice(0, count);
}

function createEntryRow(giveawayId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${GIVEAWAY_BUTTON_PREFIX}${giveawayId}`)
      .setLabel("Participer / quitter")
      .setEmoji("🎉")
      .setStyle(ButtonStyle.Primary)
  );
}

export function createGiveawayEmbed(giveaway, entryCount, winnerIds = null) {
  const ended = giveaway.status === "ended";
  const winners = winnerIds ?? giveaway.winnerIds ?? [];
  const description = ended
    ? winners.length
      ? `**Gagnant${winners.length > 1 ? "s" : ""} :** ${winners
          .map((userId) => `<@${userId}>`)
          .join(", ")}`
      : "Le giveaway est terminé, mais personne n’a participé."
    : `Réagis en cliquant sur **Participer / quitter** pour rejoindre le tirage.\n\n**Lot :** ${giveaway.prize}`;

  const embed = new EmbedBuilder()
    .setColor(ended ? 0x64748b : 0x9b59b6)
    .setAuthor({ name: "Moko Giveaway" })
    .setTitle(ended ? "🎊 Tirage terminé" : `🎉 ${giveaway.prize}`)
    .setDescription(description)
    .addFields(
      {
        name: "Organisé par",
        value: `<@${giveaway.hostId}>`,
        inline: true,
      },
      {
        name: ended ? "Gagnants demandés" : "Gagnants",
        value: `${giveaway.winnerCount}`,
        inline: true,
      },
      {
        name: "Participants",
        value: `${entryCount}`,
        inline: true,
      },
      {
        name: ended ? "Terminé" : "Fin du giveaway",
        value: ended
          ? `<t:${Math.floor(giveaway.endsAt / 1_000)}:f>`
          : `<t:${Math.floor(giveaway.endsAt / 1_000)}:R>`,
        inline: false,
      }
    )
    .setFooter({ text: `Moko Giveaway • ${giveaway.id.slice(0, 8)}` })
    .setTimestamp(ended ? giveaway.endsAt : new Date());

  return embed;
}

export class GiveawayManager {
  constructor({ client, database, isBlacklisted = () => false }) {
    this.client = client;
    this.database = database;
    this.isBlacklisted = isBlacklisted;
    this.timers = new Map();
    this.endingGiveaways = new Set();
  }

  async start({ guild, channel, hostId, prize, winnerCount, durationMs }) {
    const giveaway = {
      id: randomUUID(),
      guildId: guild.id,
      channelId: channel.id,
      hostId,
      prize,
      winnerCount,
      endsAt: Date.now() + durationMs,
      status: "active",
      winnerIds: [],
      resultAnnounced: false,
    };
    this.database.createGiveaway(giveaway);

    try {
      const message = await channel.send({
        embeds: [createGiveawayEmbed(giveaway, 0)],
        components: [createEntryRow(giveaway.id)],
        allowedMentions: { users: [hostId], roles: [] },
      });
      this.database.setGiveawayMessageId(giveaway.id, message.id);
      giveaway.messageId = message.id;
      this.schedule(giveaway.id, durationMs);
      return giveaway;
    } catch (error) {
      this.database.deleteGiveaway(giveaway.id);
      throw error;
    }
  }

  schedule(giveawayId, delayMs) {
    const existingTimer = this.timers.get(giveawayId);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      this.timers.delete(giveawayId);
      void this.finish(giveawayId);
    }, Math.min(MAX_TIMER_DELAY_MS, Math.max(0, delayMs)));
    timer.unref?.();
    this.timers.set(giveawayId, timer);
  }

  async restoreForGuild(guildId) {
    for (const giveaway of this.database.getPendingGiveaways(guildId)) {
      const delayMs =
        giveaway.status === "ending"
          ? 0
          : Math.max(0, giveaway.endsAt - Date.now());
      this.schedule(giveaway.id, delayMs);
    }
    for (const giveaway of this.database.getUnannouncedGiveaways(guildId)) {
      this.schedule(giveaway.id, 0);
    }
  }

  async handleButton(interaction) {
    const match = new RegExp(`^${GIVEAWAY_BUTTON_PREFIX}([\\w-]+)$`).exec(
      interaction.customId
    );
    if (!match || !interaction.guild) return;

    const giveaway = this.database.getGiveaway(match[1]);
    if (!giveaway || giveaway.guildId !== interaction.guild.id) {
      await interaction.reply({
        content: "Ce giveaway n’est plus disponible.",
        ephemeral: true,
      });
      return;
    }

    if (interaction.user.bot) {
      await interaction.reply({
        content: "Les bots ne peuvent pas participer.",
        ephemeral: true,
      });
      return;
    }
    if (this.isBlacklisted(interaction.user.id)) {
      await interaction.reply({
        content: "Tu ne peux pas participer aux fonctionnalités du bot.",
        ephemeral: true,
      });
      return;
    }

    const result = this.database.toggleGiveawayEntry(
      giveaway.id,
      interaction.user.id
    );
    if (!result.open) {
      await interaction.reply({
        content: "Ce giveaway est terminé.",
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: result.entered
        ? "Tu participes au giveaway ! Clique à nouveau pour te retirer."
        : "Tu as quitté le giveaway.",
      ephemeral: true,
    });
    await interaction.message
      .edit({
        embeds: [createGiveawayEmbed(giveaway, result.count)],
        components: [createEntryRow(giveaway.id)],
      })
      .catch((error) =>
        console.error(`Could not refresh giveaway ${giveaway.id}.`, error)
      );
  }

  async finish(giveawayId) {
    if (this.endingGiveaways.has(giveawayId)) return;
    this.endingGiveaways.add(giveawayId);
    const existingTimer = this.timers.get(giveawayId);
    if (existingTimer) clearTimeout(existingTimer);
    this.timers.delete(giveawayId);

    try {
      let giveaway = this.database.getGiveaway(giveawayId);
      if (!giveaway) return;

      if (giveaway.status === "active") {
        if (giveaway.endsAt > Date.now()) {
          this.schedule(giveaway.id, giveaway.endsAt - Date.now());
          return;
        }
        if (!this.database.markGiveawayEnding(giveaway.id)) return;
        giveaway = this.database.getGiveaway(giveaway.id);
      }

      if (giveaway.status === "ending") {
        const entries = this.database.getGiveawayEntries(giveaway.id);
        const winnerIds = chooseWinners(entries, giveaway.winnerCount);
        this.database.completeGiveaway(giveaway.id, winnerIds);
        giveaway = this.database.getGiveaway(giveaway.id);
      }

      if (giveaway.status === "ended" && !giveaway.resultAnnounced) {
        await this.publishResult(giveaway);
      }
    } catch (error) {
      console.error(`Could not finish giveaway ${giveawayId}.`, error);
      this.schedule(giveawayId, 30_000);
    } finally {
      this.endingGiveaways.delete(giveawayId);
    }
  }

  async publishResult(giveaway) {
    const channel =
      this.client.channels.cache.get(giveaway.channelId) ??
      (await this.client.channels.fetch(giveaway.channelId).catch(() => null));
    if (!channel?.isTextBased() || !channel.messages) {
      this.database.markGiveawayResultAnnounced(giveaway.id);
      console.warn(
        `Giveaway ${giveaway.id} ended, but its announcement channel is unavailable.`
      );
      return;
    }

    const entryCount = this.database.getGiveawayEntries(giveaway.id).length;
    const message = giveaway.messageId
      ? await channel.messages.fetch(giveaway.messageId).catch(() => null)
      : null;
    if (message) {
      await message
        .edit({
          embeds: [
            createGiveawayEmbed(giveaway, entryCount, giveaway.winnerIds),
          ],
          components: [],
          allowedMentions: { users: giveaway.winnerIds, roles: [] },
        })
        .catch((error) =>
          console.error(`Could not update giveaway ${giveaway.id}.`, error)
        );
    }

    const announcement = giveaway.winnerIds.length
      ? `🎉 Félicitations ${giveaway.winnerIds
          .map((userId) => `<@${userId}>`)
          .join(", ")} ! Vous remportez **${giveaway.prize}**.`
      : `Le giveaway **${giveaway.prize}** est terminé : aucun membre n’a participé.`;
    await channel.send({
      content: announcement,
      allowedMentions: { users: giveaway.winnerIds, roles: [] },
    });
    this.database.markGiveawayResultAnnounced(giveaway.id);
  }
}
