import assert from "node:assert/strict";
import test from "node:test";
import { BotDatabase } from "../src/database.js";

test("guild settings, jail records, and warnings persist in the database", () => {
  const database = new BotDatabase(":memory:");
  database.ensureGuild("guild");
  database.setRole("guild", "staff", "staff-role");
  database.setRole("guild", "brigade", "brigade-role");
  database.setRole("guild", "jail", "jail-role");
  database.setJailChannel("guild", "jail-room");

  assert.equal(database.getGuild("guild").staff_role_id, "staff-role");
  assert.equal(database.getGuild("guild").brigade_role_id, "brigade-role");
  assert.equal(database.getGuild("guild").jail_channel_id, "jail-room");

  database.setJail("guild", "member", "test reason", "moderator");
  assert.equal(database.getJail("guild", "member").reason, "test reason");
  assert.equal(database.removeJail("guild", "member"), true);
  assert.equal(database.getJail("guild", "member"), null);

  database.addWarning("guild", "member", "moderator", "test warning");
  assert.equal(database.getWarnings("guild", "member").length, 1);
  assert.equal(database.clearWarnings("guild", "member"), 1);
  database.db.close();
});
