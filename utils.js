"use strict";

const fs = require("node:fs");
const path = require("node:path");

function atomicSave(directory, file, value) {
  const target = path.join(directory, file);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function prepareDataDirectory(directory, dataFiles) {
  fs.mkdirSync(directory, { recursive: true });
  const marker = path.join(directory, ".bot-reset-v1");
  if (fs.existsSync(marker)) return false;

  for (const file of [
    ...Object.values(dataFiles),
    "quiz.sqlite", "quiz.sqlite-wal", "quiz.sqlite-shm",
  ]) {
    const target = path.join(directory, file);
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
  for (const file of Object.values(dataFiles)) atomicSave(directory, file, {});
  fs.writeFileSync(marker, "Initialisation réinitialisée.\n", { mode: 0o600 });
  return true;
}

function loadJson(directory, file) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (error) {
    if (error.code !== "ENOENT") console.error(`Données illisibles (${file}); démarrage avec une banque vide.`);
    return {};
  }
}

function parseDuration(input) {
  const match = String(input).match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!match) return null;
  return Number(match[1]) * ({ s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 })[match[2].toLowerCase()];
}

function parseCount(input, fallback, min, max) {
  if (!/^-?\d+$/.test(String(input ?? "").trim())) return fallback;
  const count = Number(input);
  return Number.isSafeInteger(count) && count >= min && count <= max ? count : fallback;
}

function xpForLevel(level) { return 5 * level ** 2 + 50 * level + 100; }

module.exports = { atomicSave, loadJson, parseCount, parseDuration, prepareDataDirectory, xpForLevel };
