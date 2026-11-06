import assert from "node:assert/strict";
import test from "node:test";
import { PermissionFlagsBits as P, ChannelType } from "discord.js";
import { JailDatabase } from "../src/database.js";
import { ManagementStore } from "../src/management-store.js";
import { ManagementHandler } from "../src/management.js";
import { memberLevel, assertAccess, assertTarget, assertRole } from "../src/access.js";
import { ACTIONS, commandLevels, managementCommands } from "../src/management-commands.js";

const rank = (position) => ({ position, comparePositionTo(other) { return position - other.position; } });
function member(id, position, roles = []) {
  return { id, guild: { id: "guild", ownerId: "owner" }, user: { tag: id },
    roles: { cache: new Map(roles.map((r) => [r, true])), highest: rank(position) } };
}
const config = { roles: { assistant: 1, mod: 2, admin: 3 }, commands: {}, logChannel: null };
test("all command definitions serialize and have unique actions", () => {
  for (const command of managementCommands) assert.ok(command.toJSON());
  assert.equal(new Set(ACTIONS.map(([g, a]) => `${g}.${a}`)).size, ACTIONS.length);
  assert.equal(ACTIONS.length, 42);
});
test("Jail is absent from command registration, access configuration and help", () => {
  assert.deepEqual(managementCommands.map((command) => command.toJSON().name), ["gestion", "acces", "aide"]);
  assert.ok(Object.keys(commandLevels).every((key) => !key.startsWith("jail.")));
  const handler = new ManagementHandler(null, null);
  assert.doesNotMatch(JSON.stringify(handler.help(member("owner", 20), config).toJSON()), /jail/i);
});
test("levels are cumulative, owner-only level 4, no native permission bypass", () => {
  assert.equal(memberLevel(member("owner", 1), config), 4);
  assert.equal(memberLevel(member("a", 10, ["assistant", "admin"]), config), 3);
  assert.equal(memberLevel(member("a", 10), config), 0);
  assert.throws(() => assertAccess(member("a", 10, ["mod"]), config, "roles.donner", 3));
  assert.doesNotThrow(() => assertAccess(member("a", 10, ["admin"]), config, "moderation.timeout", 2));
  assert.throws(() => assertAccess(member("a", 10, ["admin"]), { ...config, commands: { "moderation.bannir": 4 } }, "moderation.bannir", 3));
});
test("targets protect self, owner, bot, Discord hierarchy and management level", () => {
  const actor = member("actor", 10, ["mod"]);
  const bot = member("bot", 20);
  for (const target of [actor, member("owner", 1), bot, member("equal", 10), member("staff", 1, ["mod"])]) {
    assert.throws(() => assertTarget(actor, target, bot, config));
  }
  assert.doesNotThrow(() => assertTarget(actor, member("normal", 1), bot, config));
  assert.throws(() => assertTarget(member("owner", 30), member("higher", 21), bot, config));
});
test("privileged, managed, configured and Jail roles cannot be assigned", () => {
  const actor = member("owner", 30), bot = member("bot", 20);
  const settings = { brigade_role_id: "brigade", jail_role_id: "jail", rank_role_ids: ["rank"] };
  const role = { ...rank(1), id: "ordinary", permissions: { bitfield: 0n } };
  assert.doesNotThrow(() => assertRole(actor, role, bot, config, settings));
  for (const bad of [{ id: "admin" }, { id: "jail" }, { id: "rank" }, { id: "guild" }, { managed: true }, { permissions: { bitfield: P.Administrator } }]) {
    assert.throws(() => assertRole(actor, { ...role, ...bad }, bot, config, settings));
  }
});
test("settings and warning removals are scoped by guild and target", () => {
  const database = new JailDatabase(":memory:");
  try {
    const store = new ManagementStore(database.db);
    store.save("a", config);
    assert.deepEqual(new ManagementStore(database.db).get("a"), config);
    assert.deepEqual(store.get("b").roles, {});
    const id = store.record("a", "user", "actor", "avertir", "reason");
    assert.equal(store.removeWarning("b", "user", id), 0);
    assert.equal(store.removeWarning("a", "other", id), 0);
    assert.equal(store.history("a", "user", true).length, 1);
    assert.equal(store.removeWarning("a", "user", id), 1);
    assert.equal(store.history("a", "user", true).length, 0);
    assert.equal(store.history("a", "user").length, 1);
  } finally { database.close(); }
});
function interaction(group, action, values, actor) {
  let reply;
  return {
    guildId: "guild", commandName: "gestion", user: { id: actor.id },
    guild: { id: "guild", ownerId: "owner", members: { fetch: async () => actor, fetchMe: async () => member("bot", 20) } },
    inGuild: () => true, deferReply: async () => {},
    editReply: async (r) => { reply = r; }, get reply() { return reply; },
    options: Object.fromEntries([
      ["getSubcommandGroup", () => group], ["getSubcommand", () => action],
      ...["User", "Channel", "Role", "Boolean", "String", "Integer"].map((type) => [`get${type}`, (name) => values[name] ?? null]),
    ]),
  };
}
test("real handler rejects insufficient access and false destructive confirmation before execution", async () => {
  const database = new JailDatabase(":memory:");
  try {
    const store = new ManagementStore(database.db);
    store.save("guild", config);
    const handler = new ManagementHandler(store, database);
    let calls = 0;
    handler.execute = async () => { calls++; return "done"; };
    const denied = interaction("moderation", "bannir", { confirmer: true }, member("a", 10, ["mod"]));
    await handler.handle(denied);
    assert.match(denied.reply.content, /réservée/);
    const cancelled = interaction("moderation", "bannir", { confirmer: false }, member("a", 10, ["admin"]));
    await handler.handle(cancelled);
    assert.match(cancelled.reply.content, /annulée/);
    assert.equal(calls, 0);
    const allowed = interaction("moderation", "bannir", { confirmer: true }, member("owner", 10));
    await handler.handle(allowed);
    assert.equal(calls, 1);
  } finally { database.close(); }
});
test("only owner can configure role levels", async () => {
  const database = new JailDatabase(":memory:");
  try {
    const handler = new ManagementHandler(new ManagementStore(database.db), database);
    const i = interaction(null, "role", {}, member("admin", 10, ["admin"]));
    await assert.rejects(handler.configure(i, member("admin", 10, ["admin"]), structuredClone(config)), /propriétaire/);
    const help = handler.help(member("owner", 20), config).toJSON();
    assert.ok(help.fields.every((field) => field.value.length <= 1024));
  } finally { database.close(); }
});
test("lock/unlock restores exact prior tri-state permissions", async () => {
  const database = new JailDatabase(":memory:");
  try {
    const handler = new ManagementHandler(new ManagementStore(database.db), database);
    const edits = [];
    const channel = { id: "text", name: "text", type: ChannelType.GuildText,
      permissionsFor: () => ({ has: () => true }),
      permissionOverwrites: { cache: new Map([["guild", { allow: { has: (bit) => bit === P.SendMessages }, deny: { has: (bit) => bit === P.CreatePublicThreads } }]]),
        edit: async (_id, values) => edits.push(values) } };
    const i = interaction("salons", "verrouiller", {}, member("owner", 20));
    const cfg = structuredClone(config);
    await handler.manageChannel(i, member("owner", 20), {}, cfg, channel, "verrouiller", "test");
    await handler.manageChannel(i, member("owner", 20), {}, cfg, channel, "deverrouiller", "test");
    assert.equal(edits[0].SendMessages, false);
    assert.deepEqual(edits[1], { SendMessages: true, SendMessagesInThreads: null, CreatePublicThreads: false, CreatePrivateThreads: null });
    assert.deepEqual(handler.store.get("guild").locks, {});
  } finally { database.close(); }
});

test("timeout execution uses duration and checks bot permission before mutation", async () => {
  const database = new JailDatabase(":memory:");
  try {
    const handler = new ManagementHandler(new ManagementStore(database.db), database);
    const actor = member("actor", 10, ["mod"]);
    const target = { ...member("target", 1), moderatable: true };
    let timeout;
    target.timeout = async (duration) => { timeout = duration; };
    const i = interaction("moderation", "timeout", { membre: { id: "target" }, minutes: 5, raison: "test" }, actor);
    i.guild.members.fetch = async () => target;
    const bot = { ...member("bot", 20), permissions: { has: () => true } };
    await handler.execute(i, actor, bot, config, "moderation", "timeout");
    assert.equal(timeout, 300000);
    bot.permissions.has = () => false;
    timeout = undefined;
    await assert.rejects(handler.execute(i, actor, bot, config, "moderation", "timeout"), /Permission manquante/);
    assert.equal(timeout, undefined);
  } finally { database.close(); }
});
test("warning execution persists a case and returns its number", async () => {
  const database = new JailDatabase(":memory:");
  try {
    const store = new ManagementStore(database.db);
    const handler = new ManagementHandler(store, database);
    const actor = member("actor", 10, ["assistant"]);
    const target = member("target", 1);
    const i = interaction("moderation", "avertir", { membre: { id: "target" }, raison: "spam" }, actor);
    i.guild.members.fetch = async () => target;
    assert.match(await handler.execute(i, actor, member("bot", 20), config, "moderation", "avertir"), /#1/);
    assert.equal(store.history("guild", "target", true)[0].reason, "spam");
  } finally { database.close(); }
});
