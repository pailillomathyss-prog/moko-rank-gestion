import assert from "node:assert/strict";
import test from "node:test";
import { ActivityStore } from "../src/activity-store.js";
import { ActivityEngine } from "../src/activity-engine.js";
import { ActivityPanel } from "../src/activity-panel.js";

function fixture() {
  const store = new ActivityStore(":memory:");
  const guild = { id: "guild", ownerId: "owner",
    members: { fetch: async () => ({ id: "owner", guild }), fetchMe: async () => ({ permissions: { has: () => true }, roles: { highest: {} } }) },
    roles: { fetch: async (id) => ({ id, permissions: { bitfield: 0n }, managed: false, comparePositionTo: () => -1 }) } };
  const engine = new ActivityEngine(store, {});
  const panel = new ActivityPanel(store, engine);
  const interaction = (customId, values = []) => ({
    guildId: "guild", guild, user: { id: "owner" }, customId, values,
    inGuild: () => true, isChatInputCommand: () => false,
    deferUpdate: async function () { this.deferred = true; },
    editReply: async function (value) { this.output = value; },
    followUp: async function (value) { this.error = value; },
    reply: async function (value) { this.error = value; },
    update: async function (value) { this.output = value; },
    showModal: async function (value) { this.modal = value; },
  });
  return { store, guild, panel, interaction };
}
test("role selection, modal save and disabling persist through the real panel handler", async () => {
  const f = fixture();
  try {
    const select = f.interaction("activity:role:1", ["role"]);
    await f.panel.handle(select);
    assert.equal(f.store.config("guild").tiers[0].role, "role");
    assert.ok(select.output.embeds.length);
    const edit = f.interaction("activity:edit:1");
    await f.panel.handle(edit);
    assert.equal(edit.modal.toJSON().components.length, 4);
    const save = f.interaction("activity:save:1");
    save.fields = { getTextInputValue: (key) => ({ messages: "750", hours: "12", dailyMessages: "175", dailyHours: "2,5" })[key] };
    await f.panel.handle(save);
    assert.equal(f.store.config("guild").tiers[0].messages, 750);
    assert.equal(f.store.config("guild").tiers[0].dailyHours, 2.5);
    const disable = f.interaction("activity:disable:1");
    await f.panel.handle(disable);
    assert.equal(f.store.config("guild").tiers[0].role, null);
  } finally { f.store.close(); }
});
test("every panel mutation requires current administrator permissions", async () => {
  const f = fixture();
  try {
    f.guild.members.fetch = async () => ({ id: "member", guild: f.guild, permissions: { has: () => false } });
    for (const action of ["role", "save", "disable", "edit", "tier"]) {
      const i = f.interaction(`activity:${action}:1`, ["1"]);
      await f.panel.handle(i);
      assert.match(i.error.content, /réservé/);
    }
    assert.equal(f.store.config("guild").tiers[0].role, null);
  } finally { f.store.close(); }
});
test("invalid quota edits and duplicate role selections do not change config", async () => {
  const f = fixture();
  try {
    const config = f.store.config("guild");
    config.tiers[0].role = "role";
    f.store.save(config);
    const duplicate = f.interaction("activity:role:2", ["role"]);
    await f.panel.handle(duplicate);
    assert.match(duplicate.error.content, /déjà associé/);
    const invalid = f.interaction("activity:save:1");
    invalid.fields = { getTextInputValue: () => "-1" };
    await f.panel.handle(invalid);
    assert.match(invalid.error.content, /Messages/);
    assert.equal(f.store.config("guild").tiers[0].messages, 500);
    assert.equal(f.store.config("guild").tiers[1].role, null);
  } finally { f.store.close(); }
});
