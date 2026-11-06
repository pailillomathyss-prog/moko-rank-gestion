import assert from "node:assert/strict";
import test from "node:test";
import { parseSlashInvocation, SLASH_COMMANDS } from "../src/slash-commands.js";

test("slash commands are unique and cover the bot's command groups", () => {
  const names = SLASH_COMMANDS.map((command) => command.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of [
    "help",
    "stats",
    "panel",
    "giveaway",
    "kick",
    "staff",
    "gbl",
    "brigade",
    "enemy",
    "quitter",
    "quittervalider",
  ]) {
    assert.ok(names.includes(name), `expected /${name} to be registered`);
  }
});

test("brigade slash options map to the existing raid threshold handler", () => {
  const interaction = {
    commandName: "brigade",
    guild: { members: { cache: new Map() } },
    options: {
      getSubcommand: () => "seuil",
      getUser: () => null,
      getRole: () => null,
      getChannel: () => null,
      getString: () => null,
      getBoolean: () => null,
      getInteger: (name) => (name === "arrivees" ? 8 : 12),
    },
  };

  assert.deepEqual(parseSlashInvocation(interaction), {
    command: "brigade",
    args: ["seuil", "8", "12"],
    member: null,
    role: null,
    channel: null,
    user: null,
  });
});
