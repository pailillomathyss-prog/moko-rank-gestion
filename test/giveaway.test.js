import assert from "node:assert/strict";
import test from "node:test";
import { RankDatabase } from "../src/database.js";
import {
  GiveawayManager,
  parseGiveawayArguments,
} from "../src/giveaway-manager.js";

test("giveaway command parses duration, winners, and a multiword prize", () => {
  assert.deepEqual(
    parseGiveawayArguments(["2h", "2", "Pack", "de", "jeu"]),
    {
      durationMs: 7_200_000,
      winnerCount: 2,
      prize: "Pack de jeu",
    }
  );
  assert.throws(() => parseGiveawayArguments(["2mois", "1", "Nitro"]));
  assert.throws(() => parseGiveawayArguments(["2h", "0", "Nitro"]));
});

test("giveaway entries can toggle and the end publishes a stored winner", async () => {
  const database = new RankDatabase(":memory:");
  const storedMessages = new Map();
  const channelPosts = [];
  let nextMessageId = 0;
  const channel = {
    id: "channel-giveaway",
    isTextBased: () => true,
    messages: {
      fetch: async (messageId) => storedMessages.get(messageId),
    },
    send: async (payload) => {
      channelPosts.push(payload);
      const message = {
        id: `message-${++nextMessageId}`,
        edited: null,
        edit: async (updatedPayload) => {
          message.edited = updatedPayload;
          return message;
        },
      };
      storedMessages.set(message.id, message);
      return message;
    },
  };
  const client = {
    channels: {
      cache: new Map([[channel.id, channel]]),
      fetch: async () => channel,
    },
  };
  const manager = new GiveawayManager({ client, database });
  const giveaway = await manager.start({
    guild: { id: "guild-giveaway" },
    channel,
    hostId: "host",
    prize: "Nitro",
    winnerCount: 1,
    durationMs: 60_000,
  });
  const replies = [];
  const originalMessage = storedMessages.get(giveaway.messageId);
  const click = () =>
    manager.handleButton({
      customId: `moko:giveaway:enter:${giveaway.id}`,
      guild: { id: giveaway.guildId },
      user: { id: "participant", bot: false },
      message: originalMessage,
      reply: async (reply) => replies.push(reply),
    });

  await click();
  assert.deepEqual(database.getGiveawayEntries(giveaway.id), ["participant"]);
  await click();
  assert.deepEqual(database.getGiveawayEntries(giveaway.id), []);
  await click();
  assert.deepEqual(database.getGiveawayEntries(giveaway.id), ["participant"]);

  database.db
    .prepare("UPDATE giveaways SET ends_at = ? WHERE id = ?")
    .run(Date.now() - 1, giveaway.id);
  await manager.finish(giveaway.id);

  const finished = database.getGiveaway(giveaway.id);
  assert.equal(finished.status, "ended");
  assert.deepEqual(finished.winnerIds, ["participant"]);
  assert.equal(finished.resultAnnounced, true);
  assert.deepEqual(originalMessage.edited.components, []);
  assert.equal(channelPosts.length, 2);
  assert.equal(replies.length, 3);
  database.close();
});
