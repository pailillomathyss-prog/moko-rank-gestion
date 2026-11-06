import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
export function dayKey(time = Date.now()) {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(time)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export const ordinal = (day) => Math.floor(Date.parse(`${day}T12:00:00Z`) / 86400000);
export const dayFromOrdinal = (value) => new Date(value * 86400000).toISOString().slice(0, 10);
export function splitDays(start, end) {
  const result = [];
  while (start < end) {
    const day = dayKey(start);
    let boundary = end;
    if (dayKey(end - 1) !== day) {
      let low = start, high = end;
      while (high - low > 1) {
        const mid = Math.floor((low + high) / 2);
        if (dayKey(mid) === day) low = mid; else high = mid;
      }
      boundary = high;
    }
    result.push({ day, ms: boundary - start });
    start = boundary;
  }
  return result;
}
export const reached = (stats, messages, hours) => stats.messages >= messages || stats.ms >= hours * 3600000;
export function defaults() {
  return Array.from({ length: 15 }, (_, i) => ({
    slot: i + 1, role: null, messages: 500 * (i + 1), hours: 10 * (i + 1),
    dailyMessages: 150 + 50 * i, dailyHours: 2 + 0.5 * i,
  }));
}
export class ActivityStore {
  constructor(dir = "./data") {
    if (dir !== ":memory:") fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(dir === ":memory:" ? dir : path.join(dir, "activity.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS configs (guild TEXT PRIMARY KEY, anchor INTEGER NOT NULL, tiers TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS counts (guild TEXT, user TEXT, day TEXT, messages INTEGER NOT NULL DEFAULT 0, ms INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(guild,user,day));
      CREATE TABLE IF NOT EXISTS cooldowns (guild TEXT, user TEXT, time INTEGER, PRIMARY KEY(guild,user));
      CREATE TABLE IF NOT EXISTS grants (guild TEXT, user TEXT, role TEXT, earned_day TEXT, checked_day TEXT, blocked_period INTEGER, PRIMARY KEY(guild,user,role));
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS disrupted (day TEXT PRIMARY KEY);
    `);
  }
  config(guild, now = Date.now()) {
    this.db.prepare("INSERT OR IGNORE INTO configs VALUES (?,?,?)").run(guild, ordinal(dayKey(now)), JSON.stringify(defaults()));
    const row = this.db.prepare("SELECT * FROM configs WHERE guild=?").get(guild);
    return { ...row, tiers: JSON.parse(row.tiers) };
  }
  save(config) {
    this.db.prepare("UPDATE configs SET tiers=? WHERE guild=?").run(JSON.stringify(config.tiers), config.guild);
  }
  period(config, now = Date.now()) {
    return Math.floor((ordinal(dayKey(now)) - config.anchor) / 14);
  }
  stats(guild, user, from, until) {
    return this.db.prepare("SELECT COALESCE(SUM(messages),0) messages, COALESCE(SUM(ms),0) ms FROM counts WHERE guild=? AND user=? AND day>=? AND day<=?").get(guild, user, from, until);
  }
  total(config, user, now = Date.now()) {
    return this.stats(config.guild, user, dayFromOrdinal(config.anchor + this.period(config, now) * 14), dayKey(now));
  }
  message(guild, user, now = Date.now()) {
    return this.db.transaction(() => {
      const prior = this.db.prepare("SELECT time FROM cooldowns WHERE guild=? AND user=?").get(guild, user);
      if (prior && now - prior.time < 10000) return false;
      this.db.prepare("INSERT INTO cooldowns VALUES (?,?,?) ON CONFLICT(guild,user) DO UPDATE SET time=excluded.time").run(guild, user, now);
      this.db.prepare("INSERT INTO counts VALUES (?,?,?,1,0) ON CONFLICT(guild,user,day) DO UPDATE SET messages=messages+1").run(guild, user, dayKey(now));
      return true;
    })();
  }
  voice(guild, user, start, end) {
    this.db.transaction(() => {
      for (const segment of splitDays(start, end)) {
        this.db.prepare("INSERT INTO counts VALUES (?,?,?,0,?) ON CONFLICT(guild,user,day) DO UPDATE SET ms=ms+excluded.ms").run(guild, user, segment.day, segment.ms);
      }
    })();
  }
  grants(guild, user) {
    return this.db.prepare("SELECT * FROM grants WHERE guild=? AND user=?").all(guild, user);
  }
  grant(guild, user, role, day) {
    this.db.prepare("INSERT INTO grants VALUES (?,?,?,?,?,NULL) ON CONFLICT(guild,user,role) DO UPDATE SET earned_day=excluded.earned_day, checked_day=excluded.checked_day, blocked_period=NULL").run(guild, user, role, day, day);
  }
  check(guild, user, role, day) {
    this.db.prepare("UPDATE grants SET checked_day=? WHERE guild=? AND user=? AND role=?").run(day, guild, user, role);
  }
  block(guild, user, role, period) {
    this.db.prepare("UPDATE grants SET blocked_period=? WHERE guild=? AND user=? AND role=?").run(period, guild, user, role);
  }
  users(guild) {
    return this.db.prepare("SELECT user FROM counts WHERE guild=? UNION SELECT user FROM grants WHERE guild=?").all(guild, guild).map((r) => r.user);
  }
  forgetRole(guild, role) {
    this.db.prepare("DELETE FROM grants WHERE guild=? AND role=?").run(guild, role);
  }
  heartbeat(now = Date.now()) {
    const previous = this.db.prepare("SELECT value FROM meta WHERE key='heartbeat'").get();
    if (previous && now - Number(previous.value) > 120000) {
      for (let d = ordinal(dayKey(Number(previous.value))); d <= ordinal(dayKey(now)); d++) {
        this.db.prepare("INSERT OR IGNORE INTO disrupted VALUES (?)").run(dayFromOrdinal(d));
      }
    }
    this.db.prepare("INSERT INTO meta VALUES ('heartbeat',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(now));
  }
  disrupted(day) { return Boolean(this.db.prepare("SELECT 1 FROM disrupted WHERE day=?").get(day)); }
  close() { this.db.close(); }
}
