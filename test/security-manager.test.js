import assert from "node:assert/strict";
import test from "node:test";
import { RankDatabase } from "../src/database.js";
import { SecurityManager } from "../src/security-manager.js";

test("anti-raid automatically jails the burst that reaches its configured threshold", async () => {
  const database = new RankDatabase(":memory:");
  const guildId = "guild-security";
  database.ensureGuild(guildId);
  database.setJailConfig(guildId, "jail-role", "jail-room");
  database.setRaidSettings(guildId, true, 3, 10);

  const jailRole = { id: "jail-role" };
  const roleCache = new Map([[jailRole.id, jailRole]]);
  const guild = {
    id: guildId,
    roles: { cache: roleCache },
    channels: {
      cache: new Map([
        ["jail-room", { send: async () => undefined }],
      ]),
    },
  };
  const jailed = [];
  const manager = new SecurityManager({ database });

  for (const id of ["member-1", "member-2", "member-3"]) {
    const roleIds = new Set();
    const member = {
      id,
      guild,
      roles: {
        cache: { has: (roleId) => roleIds.has(roleId) },
        add: async (role) => {
          roleIds.add(role.id);
          jailed.push(id);
        },
      },
      send: async () => undefined,
    };
    await manager.onMemberJoin(member);
    member.roleIds = roleIds;
    guild.roles.cache.set(`member:${id}`, member);
  }

  assert.deepEqual(jailed, ["member-1", "member-2", "member-3"]);
  for (const id of ["member-1", "member-2", "member-3"]) {
    assert.ok(database.getJailedMember(guildId, id));
  }
  database.close();
});

test("jail sends the member instructions and brigade approval grants the exit role", async () => {
  const database = new RankDatabase(":memory:");
  const guildId = "guild-exit";
  database.ensureGuild(guildId);
  database.setJailConfig(guildId, "jail-role", "jail-room");
  database.setQuitRewardRole(guildId, "cleared-role");
  database.setBrigadeRole(guildId, "brigade-role");

  const jailRole = { id: "jail-role", position: 1 };
  const rewardRole = { id: "cleared-role", name: "Vérifié", position: 2 };
  const roles = new Map([
    [jailRole.id, jailRole],
    [rewardRole.id, rewardRole],
  ]);
  const roomMessages = [];
  const jailRoom = {
    id: "jail-room",
    send: async (payload) => roomMessages.push(payload),
  };
  const guild = {
    id: guildId,
    name: "Test Guild",
    ownerId: "owner-id",
    roles: { cache: roles },
    channels: { cache: new Map([[jailRoom.id, jailRoom]]) },
    members: { me: { roles: { highest: { position: 10 } } } },
  };
  const roleIds = new Set();
  const dms = [];
  const member = {
    id: "jailed-member",
    guild,
    user: { tag: "member#0001" },
    roles: {
      cache: { has: (id) => roleIds.has(id) },
      add: async (role) => roleIds.add(role.id),
      remove: async (roleId) => roleIds.delete(roleId),
    },
    send: async (text) => dms.push(text),
  };
  const manager = new SecurityManager({ database });

  assert.equal(await manager.jailMember(member, "Test jail", "moderator"), true);
  assert.ok(dms[0].includes("+quitter"));
  assert.equal(roomMessages[0].allowedMentions.users[0], member.id);

  await manager.handleCommand(
    {
      guild,
      member,
      author: { id: member.id },
      reply: async () => undefined,
    },
    "quitter",
    []
  );
  assert.equal(
    database.getJailExitRequest(guildId, member.id).status,
    "pending"
  );

  const brigadeMember = {
    permissions: { has: () => false },
    roles: { cache: { has: (id) => id === "brigade-role" } },
  };
  const replies = [];
  await manager.handleCommand(
    {
      guild,
      member: brigadeMember,
      author: { id: "brigade-staff" },
      mentions: { members: { first: () => member } },
      reply: async (text) => replies.push(text),
    },
    "quittervalider",
    ["@jailed-member"]
  );

  assert.ok(roleIds.has(rewardRole.id));
  assert.ok(!roleIds.has(jailRole.id));
  assert.equal(database.getJailedMember(guildId, member.id), null);
  assert.equal(
    database.getJailExitRequest(guildId, member.id).status,
    "approved"
  );
  assert.ok(replies[0].includes("Demande validée"));
  database.close();
});
