import assert from "node:assert/strict";
import test from "node:test";
import { TestSessionManager } from "../src/test-session-manager.js";
import { RANKS } from "../src/ranks.js";

test("test-panel messages grant ranks in order and restore the original rank", async () => {
  const roleIds = RANKS.map((rank) => `rank-${rank.level}`);
  const roles = roleIds.map((id, index) => ({
    id,
    name: id,
    position: index + 1,
    managed: false,
  }));
  const memberRoleCache = new Map([[roleIds[1], roles[1]]]);
  const member = {
    id: "tester",
    roles: {
      cache: memberRoleCache,
      add: async (roleOrRoles) => {
        const list = Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles];
        for (const role of list) memberRoleCache.set(role.id, role);
      },
      remove: async (roleIdsOrRoles) => {
        const list = Array.isArray(roleIdsOrRoles)
          ? roleIdsOrRoles
          : [roleIdsOrRoles];
        for (const roleOrId of list) {
          memberRoleCache.delete(
            typeof roleOrId === "string" ? roleOrId : roleOrId.id
          );
        }
      },
    },
  };
  const botMember = { roles: { highest: { position: 100 } } };
  const guild = {
    id: "guild-test",
    roles: { cache: new Map(roles.map((role) => [role.id, role])) },
    members: {
      cache: new Map([[member.id, member]]),
      me: botMember,
      fetch: async () => member,
      fetchMe: async () => botMember,
    },
  };
  member.guild = guild;

  const savedSessions = [];
  const updatedLevels = [];
  let deletedSessions = 0;
  const database = {
    ensureGuild: () => ({ roleIds }),
    saveTestSession: (session) => savedSessions.push(session),
    updateTestSessionLevel: (_guildId, _userId, level) =>
      updatedLevels.push(level),
    deleteTestSession: () => {
      deletedSessions += 1;
    },
  };
  const pausedUsers = [];
  const resumedUsers = [];
  const voiceTracker = {
    pauseUser: (...args) => pausedUsers.push(args),
    resumeUser: (...args) => resumedUsers.push(args),
  };
  const client = {
    guilds: { cache: new Map([[guild.id, guild]]) },
    channels: { cache: new Map() },
  };
  const manager = new TestSessionManager({
    client,
    database,
    voiceTracker,
    memberRoleLocks: new Map(),
    ranks: RANKS,
    ensureCurrentCycle: async () => ({ roleIds }),
  });
  const interactionReplies = [];
  await manager.handleButton({
    customId: "moko:test:start",
    guild,
    user: { id: member.id },
    memberPermissions: { has: () => true },
    channelId: "channel-test",
    reply: async (message) => interactionReplies.push(message),
  });

  assert.equal(savedSessions.length, 1);
  assert.deepEqual(savedSessions[0].originalRoleIds, [roleIds[1]]);
  assert.deepEqual(pausedUsers, [[guild.id, member.id]]);

  const messageReplies = [];
  for (const roleId of roleIds) {
    await manager.handleMessage({
      guild,
      author: { id: member.id },
      channelId: "channel-test",
      member,
      reply: async (message) => messageReplies.push(message),
    });
    assert.deepEqual([...memberRoleCache.keys()], [roleId]);
  }

  assert.deepEqual(updatedLevels, [1, 2, 3, 4, 5]);
  assert.equal(messageReplies.length, 5);

  await manager.handleButton({
    customId: "moko:test:stop",
    guild,
    user: { id: member.id },
    memberPermissions: { has: () => true },
    reply: async (message) => interactionReplies.push(message),
  });

  assert.deepEqual([...memberRoleCache.keys()], [roleIds[1]]);
  assert.equal(deletedSessions, 1);
  assert.deepEqual(resumedUsers, [[guild, member]]);
  assert.equal(manager.has(guild.id, member.id), false);
});
