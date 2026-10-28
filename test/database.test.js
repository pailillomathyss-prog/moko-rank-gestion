import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
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
    database.addMessage(guildId, "member-test");
    database.addVoiceTime(guildId, "member-test", 60_000);
    database.close();

    database = new RankDatabase(databasePath);
    assert.deepEqual(database.getStats(guildId, "member-test"), {
      messages: 1,
      voiceMs: 60_000,
    });
    assert.equal(database.getGuild(guildId).roleIds[0], "rank-one");

    const resetAt = database.getGuild(guildId).nextResetAt;
    database.resetCycle(guildId, resetAt);
    assert.deepEqual(database.getStats(guildId, "member-test"), {
      messages: 0,
      voiceMs: 0,
    });
    assert.equal(database.getGuild(guildId).cycleStartedAt, resetAt);
    assert.equal(database.getGuild(guildId).nextResetAt, resetAt + RESET_INTERVAL_MS);
    assert.equal(database.getGuild(guildId).roleIds[0], "rank-one");
    database.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
