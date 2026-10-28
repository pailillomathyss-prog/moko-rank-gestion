import Database from "better-sqlite3";
import { RESET_INTERVAL_MS, RANKS } from "./ranks.js";

export class RankDatabase {
  constructor(filePath) {
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS guild_config (
        guild_id TEXT PRIMARY KEY,
        cycle_started_at INTEGER NOT NULL,
        next_reset_at INTEGER NOT NULL,
        role_1 TEXT,
        role_2 TEXT,
        role_3 TEXT,
        role_4 TEXT,
        role_5 TEXT
      );

      CREATE TABLE IF NOT EXISTS member_stats (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        messages INTEGER NOT NULL DEFAULT 0,
        voice_ms INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS member_stats_guild_messages
        ON member_stats (guild_id, messages DESC);
    `);

    this.insertGuild = this.db.prepare(`
      INSERT OR IGNORE INTO guild_config (guild_id, cycle_started_at, next_reset_at)
      VALUES (?, ?, ?)
    `);
    this.selectGuild = this.db.prepare(
      "SELECT * FROM guild_config WHERE guild_id = ?"
    );
    this.selectStats = this.db.prepare(`
      SELECT messages, voice_ms
      FROM member_stats
      WHERE guild_id = ? AND user_id = ?
    `);
    this.incrementMessages = this.db.prepare(`
      INSERT INTO member_stats (guild_id, user_id, messages, voice_ms)
      VALUES (?, ?, 1, 0)
      ON CONFLICT (guild_id, user_id)
      DO UPDATE SET messages = member_stats.messages + 1
    `);
    this.addVoice = this.db.prepare(`
      INSERT INTO member_stats (guild_id, user_id, messages, voice_ms)
      VALUES (?, ?, 0, ?)
      ON CONFLICT (guild_id, user_id)
      DO UPDATE SET voice_ms = member_stats.voice_ms + excluded.voice_ms
    `);
    this.trackedMembers = this.db.prepare(
      "SELECT user_id FROM member_stats WHERE guild_id = ?"
    );
  }

  ensureGuild(guildId, now = Date.now()) {
    this.insertGuild.run(guildId, now, now + RESET_INTERVAL_MS);
    return this.getGuild(guildId);
  }

  getGuild(guildId) {
    const row = this.selectGuild.get(guildId);
    if (!row) return null;
    return {
      guildId: row.guild_id,
      cycleStartedAt: row.cycle_started_at,
      nextResetAt: row.next_reset_at,
      roleIds: RANKS.map((rank) => row[`role_${rank.level}`] ?? null),
    };
  }

  setRankRole(guildId, level, roleId) {
    if (!Number.isInteger(level) || level < 1 || level > RANKS.length) {
      throw new RangeError("Rank level must be between 1 and 5.");
    }
    this.db
      .prepare(`UPDATE guild_config SET role_${level} = ? WHERE guild_id = ?`)
      .run(roleId, guildId);
  }

  getStats(guildId, userId) {
    const row = this.selectStats.get(guildId, userId);
    return {
      messages: row?.messages ?? 0,
      voiceMs: row?.voice_ms ?? 0,
    };
  }

  addMessage(guildId, userId) {
    this.incrementMessages.run(guildId, userId);
  }

  addVoiceTime(guildId, userId, milliseconds) {
    const delta = Math.floor(milliseconds);
    if (delta > 0) this.addVoice.run(guildId, userId, delta);
  }

  getTrackedUserIds(guildId) {
    return this.trackedMembers.all(guildId).map((row) => row.user_id);
  }

  resetCycle(guildId, cycleStartedAt) {
    const reset = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM member_stats WHERE guild_id = ?")
        .run(guildId);
      this.db
        .prepare(`
          UPDATE guild_config
          SET cycle_started_at = ?, next_reset_at = ?
          WHERE guild_id = ?
        `)
        .run(
          cycleStartedAt,
          cycleStartedAt + RESET_INTERVAL_MS,
          guildId
        );
    });
    reset();
  }

  close() {
    this.db.close();
  }
}
