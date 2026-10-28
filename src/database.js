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

      CREATE TABLE IF NOT EXISTS test_sessions (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        role_ids_json TEXT NOT NULL,
        original_role_ids_json TEXT NOT NULL,
        current_level INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      );
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
    this.selectTestSessions = this.db.prepare(
      "SELECT * FROM test_sessions WHERE guild_id = ?"
    );
    this.insertTestSession = this.db.prepare(`
      INSERT INTO test_sessions (
        guild_id, user_id, channel_id, role_ids_json,
        original_role_ids_json, current_level
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (guild_id, user_id) DO UPDATE SET
        channel_id = excluded.channel_id,
        role_ids_json = excluded.role_ids_json,
        original_role_ids_json = excluded.original_role_ids_json,
        current_level = excluded.current_level
    `);
    this.updateTestLevel = this.db.prepare(`
      UPDATE test_sessions
      SET current_level = ?
      WHERE guild_id = ? AND user_id = ?
    `);
    this.deleteTestSessionStatement = this.db.prepare(`
      DELETE FROM test_sessions
      WHERE guild_id = ? AND user_id = ?
    `);
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

  saveTestSession(session) {
    this.insertTestSession.run(
      session.guildId,
      session.userId,
      session.channelId,
      JSON.stringify(session.roleIds),
      JSON.stringify(session.originalRoleIds),
      session.currentLevel
    );
  }

  getTestSessions(guildId) {
    return this.selectTestSessions.all(guildId).map((row) => ({
      guildId: row.guild_id,
      userId: row.user_id,
      channelId: row.channel_id,
      roleIds: JSON.parse(row.role_ids_json),
      originalRoleIds: JSON.parse(row.original_role_ids_json),
      currentLevel: row.current_level,
    }));
  }

  updateTestSessionLevel(guildId, userId, currentLevel) {
    this.updateTestLevel.run(currentLevel, guildId, userId);
  }

  deleteTestSession(guildId, userId) {
    this.deleteTestSessionStatement.run(guildId, userId);
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
