import assert from "node:assert/strict";
import test from "node:test";
import { createHelpEmbeds, slashCommands } from "../src/commands.js";

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

test("help provides separate permission and jail workflow embeds", () => {
  const embeds = createHelpEmbeds();
  const titles = embeds.map((embed) => embed.data.title);
  const descriptions = embeds
    .flatMap((embed) => embed.data.fields.map((field) => field.value))
    .join("\n");

  assert.deepEqual(titles, [
    "Gestion du staff",
    "Modération",
    "Brigade jail — permissions",
    "Jail — fonctionnement et étapes",
  ]);
  assert.match(descriptions, /Gérer les rôles/);
  assert.match(descriptions, /Gérer le serveur/);
  assert.match(descriptions, /\/brigade jail/);
  assert.match(descriptions, /\/unjail/);
});
