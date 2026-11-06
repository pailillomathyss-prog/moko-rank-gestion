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
