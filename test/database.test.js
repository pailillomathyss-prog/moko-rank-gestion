import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { RankDatabase } from "../src/database.js";
import { RESET_INTERVAL_MS } from "../src/ranks.js";

test("guild settings and member stats persist, then reset on the 14-day boundary", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "moko-rank-test-"));
  const databasePath = path.join(directory, "rank.sqlite");
  const guildId = "guild-test";
  const firstCycleStart = 1_000_000;

  try {
    let database = new RankDatabase(databasePath);
    const settings = database.ensureGuild(guildId, firstCycleStart);
    assert.equal(settings.nextResetAt, firstCycleStart + RESET_INTERVAL_MS);

    database.setRankRole(guildId, 1, "rank-one");
    database.setRankLogChannel(guildId, "rank-logs");
    database.setStaffRole(guildId, "staff-role");
    database.addMessage(guildId, "member-test");
    database.addVoiceTime(guildId, "member-test", 60_000);
    const warningId = database.addWarning(
      guildId,
      "member-test",
      "moderator",
      "Test warning",
      firstCycleStart
    );
    database.addGlobalBlacklist("123456789012345", "Global test", "owner");
    database.saveTestSession({
      guildId,
      userId: "tester",
      channelId: "test-channel",
      roleIds: ["rank-one", "rank-two"],
      originalRoleIds: ["rank-one"],
      currentLevel: 2,
    });
    database.updateTestSessionLevel(guildId, "tester", 3);
    const giveaway = {
      id: "giveaway-test",
      guildId,
      channelId: "giveaway-channel",
      hostId: "host",
      prize: "Nitro",
      winnerCount: 1,
      endsAt: Date.now() + 60_000,
    };
    database.createGiveaway(giveaway);
    database.setGiveawayMessageId(giveaway.id, "giveaway-message");
    database.toggleGiveawayEntry(giveaway.id, "participant");
    database.close();

    database = new RankDatabase(databasePath);
    assert.deepEqual(database.getStats(guildId, "member-test"), {
      messages: 1,
      voiceMs: 60_000,
    });
    assert.equal(database.getGuild(guildId).roleIds[0], "rank-one");
    assert.equal(database.getGuild(guildId).rankLogChannelId, "rank-logs");
    assert.equal(database.getGuild(guildId).staffRoleId, "staff-role");
    assert.equal(database.getWarnings(guildId, "member-test")[0].id, warningId);
    assert.equal(database.isGloballyBlacklisted("123456789012345"), true);
    assert.deepEqual(database.getTestSessions(guildId), [
      {
        guildId,
        userId: "tester",
        channelId: "test-channel",
        roleIds: ["rank-one", "rank-two"],
        originalRoleIds: ["rank-one"],
        currentLevel: 3,
      },
    ]);
    assert.deepEqual(database.getGiveaway(giveaway.id), {
      ...giveaway,
      messageId: "giveaway-message",
      status: "active",
      winnerIds: [],
      resultAnnounced: false,
    });
    assert.deepEqual(database.getGiveawayEntries(giveaway.id), ["participant"]);

    const resetAt = database.getGuild(guildId).nextResetAt;
    database.resetCycle(guildId, resetAt);
    assert.deepEqual(database.getStats(guildId, "member-test"), {
      messages: 0,
      voiceMs: 0,
    });
    assert.equal(database.getGuild(guildId).cycleStartedAt, resetAt);
    assert.equal(database.getGuild(guildId).nextResetAt, resetAt + RESET_INTERVAL_MS);
    assert.equal(database.getGuild(guildId).roleIds[0], "rank-one");
    assert.equal(database.getGuild(guildId).rankLogChannelId, "rank-logs");
    assert.equal(database.getGuild(guildId).staffRoleId, "staff-role");
    assert.equal(database.clearWarnings(guildId, "member-test"), 1);
    assert.equal(database.removeGlobalBlacklist("123456789012345"), true);
    database.deleteTestSession(guildId, "tester");
    assert.deepEqual(database.getTestSessions(guildId), []);
    assert.equal(database.markGiveawayEnding(giveaway.id), true);
    assert.equal(database.completeGiveaway(giveaway.id, ["participant"]), true);
    assert.deepEqual(database.getGiveaway(giveaway.id).winnerIds, ["participant"]);
    database.markGiveawayResultAnnounced(giveaway.id);
    assert.equal(database.getGiveaway(giveaway.id).resultAnnounced, true);
    database.deleteGiveaway(giveaway.id);
    assert.equal(database.getGiveaway(giveaway.id), null);
    database.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("existing guild databases gain the rank-log setting without losing data", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "moko-rank-legacy-"));
  const databasePath = path.join(directory, "rank.sqlite");
  const legacy = new Database(databasePath);
  legacy.exec(`
    CREATE TABLE guild_config (
      guild_id TEXT PRIMARY KEY,
      cycle_started_at INTEGER NOT NULL,
      next_reset_at INTEGER NOT NULL,
      role_1 TEXT, role_2 TEXT, role_3 TEXT, role_4 TEXT, role_5 TEXT
    );
    INSERT INTO guild_config VALUES (
      'guild-legacy', 1000, 2000, 'one', NULL, NULL, NULL, NULL
    );
  `);
  legacy.close();

  try {
    const database = new RankDatabase(databasePath);
    const settings = database.getGuild("guild-legacy");
    assert.equal(settings.roleIds[0], "one");
    assert.equal(settings.rankLogChannelId, null);
    database.setRankLogChannel("guild-legacy", "logs");
    assert.equal(database.getGuild("guild-legacy").rankLogChannelId, "logs");
    database.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
