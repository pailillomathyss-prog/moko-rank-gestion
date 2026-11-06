import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityStore, dayKey, defaults, reached, splitDays } from "../src/activity-store.js";
import { ActivityEngine, safeRole } from "../src/activity-engine.js";
import { ActivityPanel, activityCommand, parseQuotas, requireAdmin } from "../src/activity-panel.js";

const at = (day, hour = "12:00") => Date.parse(`${day}T${hour}:00Z`);
function fixture() {
  const store = new ActivityStore(":memory:");
  const role = { id: "role", managed: false, permissions: { bitfield: 0n }, comparePositionTo: () => -1 };
  const calls = { add: 0, remove: 0 };
  const member = { id: "user", user: { bot: false }, roles: {
    cache: new Map(), add: async (r) => { calls.add++; member.roles.cache.set(r.id, r); },
    remove: async (r) => { calls.remove++; member.roles.cache.delete(r.id); },
  } };
  const bot = { permissions: { has: () => true }, roles: { highest: {} } };
  const guild = { id: "guild", afkChannelId: "afk",
    members: { me: bot, fetch: async () => member },
    roles: { fetch: async () => role }, voiceStates: { cache: new Map() } };
  const client = { guilds: { cache: new Map([["guild", guild]]) } };
  const config = store.config("guild", at("2026-11-09"));
  config.tiers[0].role = "role";
  store.save(config);
  const engine = new ActivityEngine(store, client);
  const set = (day, messages, ms = 0) => store.db.prepare("INSERT INTO counts VALUES ('guild','user',?,?,?) ON CONFLICT(guild,user,day) DO UPDATE SET messages=excluded.messages,ms=excluded.ms").run(day, messages, ms);
  return { store, config, engine, guild, role, bot, member, calls, set };
}
test("default 15 increasing tiers use the requested first quotas and realistic daily hours", () => {
  const tiers = defaults();
  assert.equal(tiers.length, 15);
  assert.deepEqual(tiers[0], { slot: 1, role: null, messages: 500, hours: 10, dailyMessages: 150, dailyHours: 2 });
  for (let i = 1; i < 15; i++) {
    for (const key of ["messages", "hours", "dailyMessages", "dailyHours"]) assert.ok(tiers[i][key] > tiers[i - 1][key]);
    assert.ok(tiers[i].dailyHours <= 24);
  }
});
test("thresholds are OR, exact equality passes and values below both fail", () => {
  assert.ok(reached({ messages: 500, ms: 0 }, 500, 10));
  assert.ok(reached({ messages: 0, ms: 36000000 }, 500, 10));
  assert.equal(reached({ messages: 499, ms: 35999999 }, 500, 10), false);
});
test("messages count once per 10 seconds and guilds are isolated", () => {
  const store = new ActivityStore(":memory:");
  try {
    const now = at("2026-11-09");
    assert.equal(store.message("g", "u", now), true);
    assert.equal(store.message("g", "u", now + 9999), false);
    assert.equal(store.message("g", "u", now + 10000), true);
    assert.equal(store.message("other", "u", now), true);
    assert.equal(store.stats("g", "u", "2026-11-09", "2026-11-09").messages, 2);
  } finally { store.close(); }
});
test("14-day reset respects Paris midnight without removing grants or historical counts", () => {
  const f = fixture();
  try {
    f.set("2026-11-22", 500);
    f.store.grant("guild", "user", "role", "2026-11-22");
    assert.equal(f.store.total(f.config, "user", at("2026-11-22", "22:59")).messages, 500);
    assert.equal(f.store.total(f.config, "user", at("2026-11-22", "23:00")).messages, 0);
    assert.equal(f.store.grants("guild", "user").length, 1);
    assert.equal(f.store.stats("guild", "user", "2026-11-22", "2026-11-22").messages, 500);
  } finally { f.store.close(); }
});
test("voice splits at Paris midnight and daylight-saving days", () => {
  assert.deepEqual(splitDays(at("2026-11-09", "22:30"), at("2026-11-09", "23:30")), [
    { day: "2026-11-09", ms: 1800000 }, { day: "2026-11-10", ms: 1800000 },
  ]);
  const spring = splitDays(at("2026-03-28", "23:00"), at("2026-03-29", "22:00"));
  assert.deepEqual(spring, [{ day: "2026-03-29", ms: 23 * 3600000 }]);
  const autumn = splitDays(at("2026-10-24", "22:00"), at("2026-10-25", "23:00"));
  assert.deepEqual(autumn, [{ day: "2026-10-25", ms: 25 * 3600000 }]);
  assert.equal(dayKey(at("2026-07-01", "22:00")), "2026-07-02");
});
test("award by messages, exempt award day, then remove only after next full day fails", async () => {
  const f = fixture();
  try {
    f.set("2026-11-09", 500);
    await f.engine.evaluate(f.guild, "user", at("2026-11-09"));
    assert.equal(f.calls.add, 1);
    await f.engine.evaluate(f.guild, "user", at("2026-11-10"));
    assert.equal(f.calls.remove, 0);
    await f.engine.evaluate(f.guild, "user", at("2026-11-11"));
    assert.equal(f.calls.remove, 1);
    await f.engine.evaluate(f.guild, "user", at("2026-11-11"));
    assert.equal(f.calls.add, 1);
    f.set("2026-11-23", 500);
    await f.engine.evaluate(f.guild, "user", at("2026-11-23"));
    assert.equal(f.calls.add, 2);
  } finally { f.store.close(); }
});
test("voice alone earns role and either daily quota retains it", async () => {
  const f = fixture();
  try {
    f.set("2026-11-09", 0, 10 * 3600000);
    await f.engine.evaluate(f.guild, "user", at("2026-11-09"));
    f.set("2026-11-10", 150, 0);
    await f.engine.evaluate(f.guild, "user", at("2026-11-11"));
    f.set("2026-11-11", 0, 2 * 3600000);
    await f.engine.evaluate(f.guild, "user", at("2026-11-12"));
    assert.deepEqual(f.calls, { add: 1, remove: 0 });
  } finally { f.store.close(); }
});
test("manual roles are not adopted or removed", async () => {
  const f = fixture();
  try {
    f.member.roles.cache.set("role", f.role);
    f.set("2026-11-09", 1000);
    await f.engine.evaluate(f.guild, "user", at("2026-11-09"));
    await f.engine.evaluate(f.guild, "user", at("2026-11-12"));
    assert.deepEqual(f.calls, { add: 0, remove: 0 });
    assert.equal(f.store.grants("guild", "user").length, 0);
  } finally { f.store.close(); }
});
test("failed Discord removal keeps tracking for retry", async () => {
  const f = fixture();
  try {
    f.set("2026-11-09", 500);
    await f.engine.evaluate(f.guild, "user", at("2026-11-09"));
    const remove = f.member.roles.remove;
    f.member.roles.remove = async () => { throw new Error("Discord unavailable"); };
    await f.engine.evaluate(f.guild, "user", at("2026-11-11"));
    assert.equal(f.store.grants("guild", "user")[0].blocked_period, null);
    f.member.roles.remove = remove;
    await f.engine.evaluate(f.guild, "user", at("2026-11-11"));
    assert.equal(f.calls.remove, 1);
  } finally { f.store.close(); }
});
test("downtime days are exempt from removal and no offline voice is credited", async () => {
  const f = fixture();
  try {
    f.set("2026-11-09", 500);
    await f.engine.evaluate(f.guild, "user", at("2026-11-09"));
    f.store.heartbeat(at("2026-11-10"));
    f.store.heartbeat(at("2026-11-11"));
    await f.engine.evaluate(f.guild, "user", at("2026-11-11"));
    assert.equal(f.calls.remove, 0);
    f.engine.voice.set("guild:user", { guild: "guild", user: "user", since: at("2026-11-10") });
    f.engine.settleVoice(f.guild, at("2026-11-11"));
    assert.equal(f.store.total(f.config, "user", at("2026-11-11")).ms, 0);
  } finally { f.store.close(); }
});
test("vocal counts connected humans, excludes AFK and bots, and does not double count", () => {
  const f = fixture();
  try {
    f.guild.voiceStates.cache.set("user", { id: "user", channelId: "voice", member: f.member });
    f.guild.voiceStates.cache.set("afkuser", { id: "afkuser", channelId: "afk", member: f.member });
    f.guild.voiceStates.cache.set("bot", { id: "bot", channelId: "voice", member: { user: { bot: true } } });
    const now = at("2026-11-09");
    f.engine.settleVoice(f.guild, now);
    f.engine.settleVoice(f.guild, now + 60000);
    f.engine.settleVoice(f.guild, now + 90000);
    assert.equal(f.store.total(f.config, "user", now).ms, 90000);
    assert.equal(f.store.total(f.config, "afkuser", now).ms, 0);
    assert.equal(f.store.total(f.config, "bot", now).ms, 0);
    f.guild.voiceStates.cache.clear();
    f.engine.settleVoice(f.guild, now + 100000);
    f.engine.settleVoice(f.guild, now + 110000);
    assert.equal(f.store.total(f.config, "user", now).ms, 100000);
  } finally { f.store.close(); }
});
test("config, counts and grants survive database reopening", () => {
  const dir = mkdtempSync(join(tmpdir(), "activity-"));
  let store;
  try {
    store = new ActivityStore(dir);
    const config = store.config("g");
    config.tiers[0].role = "r";
    store.save(config);
    store.message("g", "u");
    store.grant("g", "u", "r", dayKey());
    store.close();
    store = new ActivityStore(dir);
    assert.equal(store.config("g").tiers[0].role, "r");
    assert.equal(store.total(store.config("g"), "u").messages, 1);
    assert.equal(store.grants("g", "u")[0].role, "r");
  } finally { store?.close(); rmSync(dir, { recursive: true, force: true }); }
});
test("panel builders serialize, restrict administration and validate quotas", () => {
  const f = fixture();
  try {
    const panel = new ActivityPanel(f.store, f.engine);
    assert.deepEqual(activityCommand.toJSON().options.map((o) => o.name), ["panel", "progression", "guide"]);
    const config = f.store.config("guild");
    for (const tier of config.tiers) tier.role = "1234567890123456789";
    f.store.save(config);
    const payload = panel.panel("guild", 15);
    const embed = payload.embeds[0].toJSON();
    assert.ok(embed.fields.every((field) => field.value.length <= 1024));
    for (const row of payload.components) row.toJSON();
    panel.guide().toJSON();
    assert.ok(panel.progression("guild", "user").embeds[0].toJSON().fields.every((field) => field.value.length <= 1024));
    requireAdmin({ id: "owner", guild: { ownerId: "owner" } });
    assert.throws(() => requireAdmin({ id: "user", guild: { ownerId: "owner" }, permissions: { has: () => false } }));
    const fields = (values) => ({ getTextInputValue: (id) => values[id] });
    assert.equal(parseQuotas(fields({ messages: "500", hours: "10", dailyMessages: "150", dailyHours: "2,5" })).dailyHours, 2.5);
    for (const invalid of ["0", "-1", "NaN", "25"]) {
      assert.throws(() => parseQuotas(fields({ messages: "500", hours: "10", dailyMessages: "150", dailyHours: invalid })));
    }
    assert.throws(() => safeRole(f.guild, { ...f.role, permissions: { bitfield: 8n } }, f.bot));
    assert.throws(() => safeRole(f.guild, { ...f.role, managed: true }, f.bot));
  } finally { f.store.close(); }
});
