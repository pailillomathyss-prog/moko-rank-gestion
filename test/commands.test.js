import assert from "node:assert/strict";
import test from "node:test";
import { slashCommands } from "../src/commands.js";

test("minimal slash command set covers staff, moderation, and jail", () => {
  const payloads = slashCommands.map((command) => command.toJSON());
  const names = payloads.map((command) => command.name);

  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names, ["help", "staff", "mod", "brigade", "jail", "unjail"]);
  assert.deepEqual(
    payloads.find((command) => command.name === "mod").options.map((sub) => sub.name),
    [
      "kick",
      "ban",
      "unban",
      "timeout",
      "untimeout",
      "clear",
      "warn",
      "warnings",
      "effacer_warnings",
    ],
  );
});
