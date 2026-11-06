import assert from "node:assert/strict";
import test from "node:test";
import { AdminCommands } from "../src/admin-commands.js";
import { RankDatabase } from "../src/database.js";

test("global ban requires explicit confirmation and records a global block", async () => {
  const database = new RankDatabase(":memory:");
  const bans = [];
  const guild = {
    id: "guild-test",
    name: "Test guild",
    members: {
      ban: async (userId, options) => bans.push({ userId, options }),
    },
  };
  const commands = new AdminCommands({
    client: { guilds: { cache: new Map([[guild.id, guild]]) } },
    database,
    ownerId: "owner-id",
  });
  const replies = [];
  const message = {
    author: { id: "owner-id" },
    reply: async (text) => replies.push(text),
  };
  const userId = "123456789012345";

  await commands.handleGlobalBlacklist(message, ["ban", userId]);
  assert.equal(database.isGloballyBlacklisted(userId), false);
  assert.equal(bans.length, 0);
  assert.match(replies[0], /confirmer/);

  await commands.handleGlobalBlacklist(message, [
    "ban",
    userId,
    "confirmer",
    "spam",
  ]);
  assert.equal(database.isGloballyBlacklisted(userId), true);
  assert.equal(bans.length, 1);
  assert.equal(bans[0].userId, userId);
  assert.match(replies[1], /BL globale/);
  database.close();
});
