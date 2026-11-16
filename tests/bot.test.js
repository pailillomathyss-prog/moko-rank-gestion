"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { clearLegacySlashCommands, commands } = require("../index");
const {
  atomicSave,
  loadJson,
  parseCount,
  parseDuration,
  prepareDataDirectory,
  xpForLevel,
} = require("../utils");

const files = {
  warns: "warns.json",
  giveaways: "giveaways.json",
  ranks: "ranks.json",
  autorole: "autorole.json",
};

test("durées et nombres ont des limites strictes", () => {
  assert.equal(parseDuration("10m"), 600_000);
  assert.equal(parseDuration("2h"), 7_200_000);
  assert.equal(parseDuration("1d"), 86_400_000);
  assert.equal(parseDuration("5 elephants"), null);
  assert.equal(parseCount("99", null, 1, 99), 99);
  assert.equal(parseCount("100", null, 1, 99), null);
  assert.equal(parseCount("2junk", null, 1, 99), null);
});

test("le premier démarrage efface scores et réglages une seule fois", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "discord-bot-reset-"));
  try {
    for (const file of Object.values(files)) atomicSave(directory, file, { old: true });
    for (const file of ["quiz.sqlite", "quiz.sqlite-wal", "quiz.sqlite-shm"]) {
      fs.writeFileSync(path.join(directory, file), "old data");
    }
    fs.writeFileSync(path.join(directory, "unrelated.txt"), "keep");

    assert.equal(prepareDataDirectory(directory, files), true);
    for (const file of Object.values(files)) assert.deepEqual(loadJson(directory, file), {});
    for (const file of ["quiz.sqlite", "quiz.sqlite-wal", "quiz.sqlite-shm"]) {
      assert.equal(fs.existsSync(path.join(directory, file)), false);
    }

    atomicSave(directory, files.ranks, { new: true });
    assert.equal(prepareDataDirectory(directory, files), false);
    assert.deepEqual(loadJson(directory, files.ranks), { new: true });
    assert.equal(fs.readFileSync(path.join(directory, "unrelated.txt"), "utf8"), "keep");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("courbe XP augmente avec chaque niveau", () => {
  assert.equal(xpForLevel(1), 155);
  assert.ok(xpForLevel(5) > xpForLevel(2));
});

test("toutes les commandes du bot sont préfixées et disponibles", () => {
  for (const name of [
    "help", "panel", "clear", "kick", "ban", "unban", "mute", "unmute",
    "warn", "unwarn", "warns", "clearwarns", "lock", "unlock", "slowmode",
    "hide", "show", "nuke", "serverinfo", "userinfo", "botinfo", "ping",
    "gstart", "gend", "greroll", "gpanel", "rank", "leaderboard", "setlevel",
    "resetrank", "autorole", "autoroleoff", "addrole", "removerole",
  ]) assert.equal(typeof commands.get(name), "function", `commande manquante : +${name}`);
  assert.equal(commands.has("config"), false);
});

test("la synchronisation distante supprime les commandes slash globales et par serveur", async () => {
  const cleared = [];
  const discordClient = {
    application: { commands: { set: async commands => cleared.push(["global", commands]) } },
    guilds: { cache: new Map([
      ["1", { commands: { set: async commands => cleared.push(["1", commands]) } }],
      ["2", { commands: { set: async commands => cleared.push(["2", commands]) } }],
    ]) },
  };
  await clearLegacySlashCommands(discordClient);
  assert.deepEqual(cleared, [["global", []], ["1", []], ["2", []]]);
});
