import assert from "node:assert/strict";
import test from "node:test";
import { ChannelType } from "discord.js";
import { JailDatabase } from "../src/database.js";
import { applyJailRestriction, buildJailGuide, jailCommand } from "../src/commands.js";
import { createMembershipMonitor } from "../src/membership-monitor.js";

test("jail command exposes setup, jail, release, and status", () => {
  const command = jailCommand.toJSON();
  assert.equal(command.name, "jail");
  assert.deepEqual(
    command.options.map((option) => option.name),
    ["setup", "mettre", "liberer", "etat", "surveillance", "serveurs"],
  );
});

test("jail guide explains setup, permissions, rank progression, and limits", () => {
  const embed = buildJailGuide({});
  const text = embed.data.fields.map((field) => field.value).join("\n");
  assert.match(text, /\/jail setup/);
  assert.match(text, /Gérer le serveur/);
  assert.match(text, /rang suivant/);
  assert.match(text, /sans parcourir les listes de membres existantes/);
  assert.match(text, /\/jail surveillance activer/);
  assert.match(text, /sans parcourir les listes de membres existantes/);
});

test("membership monitoring requires opt-in and only checks join events", async () => {
  const db = new JailDatabase(":memory:");
  try {
    db.addMonitoredGuild("home", "approved", "admin");
    db.addMonitoredGuild("home", "not-approved", "admin");
    db.allowMembershipMonitoring("approved", "external-admin");

    const checked = [];
    const homeMember = { id: "member", guild: { id: "home" } };
    const homeGuild = {
      id: "home",
      members: { fetch: async () => homeMember },
    };
    const approvedGuild = {
      id: "approved",
      members: { fetch: async () => ({ id: "member" }) },
    };
    const unapprovedGuild = {
      id: "not-approved",
      members: { fetch: async () => ({ id: "member" }) },
    };
    const client = {
      guilds: {
        cache: new Map([
          ["home", homeGuild],
          ["approved", approvedGuild],
          ["not-approved", unapprovedGuild],
        ]),
      },
    };
    const monitor = createMembershipMonitor(
      db,
      client,
      async (guild, member, sourceGuild) => {
        checked.push({ guild: guild.id, member: member.id, source: sourceGuild.id });
      },
    );

    await monitor(homeMember);
    assert.deepEqual(checked, [
      { guild: "home", member: "member", source: "approved" },
    ]);

    await monitor({
      id: "member",
      guild: approvedGuild,
    });
    assert.equal(checked.length, 2);
    assert.deepEqual(checked[1], {
      guild: "home",
      member: "member",
      source: "approved",
    });

    db.revokeMembershipMonitoring("approved");
    await monitor({ id: "member", guild: approvedGuild });
    assert.equal(checked.length, 2);
  } finally {
    db.close();
  }
});

test("jail restrictions deny access and speaking in existing channels", async () => {
  let edited;
  await applyJailRestriction(
    {
      type: ChannelType.GuildText,
      permissionOverwrites: {
        edit: async (roleId, permissions) => {
          edited = { roleId, permissions };
        },
      },
    },
    "jail-role",
  );
  assert.equal(edited.roleId, "jail-role");
  assert.equal(edited.permissions.ViewChannel, false);
  assert.equal(edited.permissions.SendMessages, false);
  assert.equal(edited.permissions.Connect, false);
});

test("jail database promotes on each release and caps at configured ranks", () => {
  const db = new JailDatabase(":memory:");
  try {
    db.saveSetup("guild", {
      brigadeRoleId: "brigade",
      jailRoleId: "jail",
      categoryId: "category",
      jailChannelId: "cell",
      logChannelId: "logs",
      rankRoleIds: ["r1", "r2", "r3"],
    });
    assert.equal(db.getSettings("guild").rank_role_ids.length, 3);

    db.addJail("guild", "member", "test 1", "staff");
    assert.equal(db.removeJailAndPromote("guild", "member", 3).rank_level, 1);
    db.addJail("guild", "member", "test 2", "staff");
    assert.equal(db.removeJailAndPromote("guild", "member", 3).rank_level, 2);
    db.addJail("guild", "member", "test 3", "staff");
    assert.equal(db.removeJailAndPromote("guild", "member", 3).rank_level, 3);
    db.addJail("guild", "member", "test 4", "staff");
    const progress = db.removeJailAndPromote("guild", "member", 3);
    assert.equal(progress.rank_level, 3);
    assert.equal(progress.unjail_count, 4);
    assert.equal(db.removeJailAndPromote("guild", "member", 3), null);
  } finally {
    db.close();
  }
});
