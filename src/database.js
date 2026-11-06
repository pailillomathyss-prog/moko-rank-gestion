import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export class JailDatabase {
  constructor(dataDir = "./data") {
    if (dataDir === ":memory:") {
      this.db = new Database(":memory:");
    } else {
      fs.mkdirSync(dataDir, { recursive: true });
      this.db = new Database(path.join(dataDir, "jail.sqlite"));
    }
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        brigade_role_id TEXT,
        jail_role_id TEXT,
        jail_category_id TEXT,
        jail_channel_id TEXT,
        log_channel_id TEXT,
        rank_role_ids TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS jail_records (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        jailed_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS member_progress (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        unjail_count INTEGER NOT NULL DEFAULT 0,
        rank_level INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      );
    `);
  }

  ensureGuild(guildId) {
    this.db
      .prepare("INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)")
      .run(guildId);
  }

  getSettings(guildId) {
    this.ensureGuild(guildId);
    const row = this.db
      .prepare("SELECT * FROM guild_settings WHERE guild_id = ?")
      .get(guildId);
    return { ...row, rank_role_ids: JSON.parse(row.rank_role_ids) };
  }

  saveSetup(guildId, setup) {
    this.ensureGuild(guildId);
    this.db
      .prepare(
        `UPDATE guild_settings SET brigade_role_id = ?, jail_role_id = ?,
          jail_category_id = ?, jail_channel_id = ?, log_channel_id = ?,
          rank_role_ids = ? WHERE guild_id = ?`,
      )
      .run(
        setup.brigadeRoleId,
        setup.jailRoleId,
        setup.categoryId,
        setup.jailChannelId,
        setup.logChannelId,
        JSON.stringify(setup.rankRoleIds),
        guildId,
      );
  }

  addJail(guildId, userId, reason, moderatorId) {
    this.db
      .prepare(
        `INSERT INTO jail_records (guild_id, user_id, reason, moderator_id, jailed_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, user_id) DO UPDATE SET
           reason = excluded.reason, moderator_id = excluded.moderator_id,
           jailed_at = excluded.jailed_at`,
      )
      .run(guildId, userId, reason, moderatorId, Date.now());
  }

  getJail(guildId, userId) {
    return this.db
      .prepare("SELECT * FROM jail_records WHERE guild_id = ? AND user_id = ?")
      .get(guildId, userId);
  }

  removeJailAndPromote(guildId, userId, rankCount) {
    const transaction = this.db.transaction(() => {
      const jail = this.getJail(guildId, userId);
      if (!jail) return null;
      this.db
        .prepare("DELETE FROM jail_records WHERE guild_id = ? AND user_id = ?")
        .run(guildId, userId);
      this.db
        .prepare(
          `INSERT INTO member_progress (guild_id, user_id, unjail_count, rank_level)
           VALUES (?, ?, 1, ?)
           ON CONFLICT(guild_id, user_id) DO UPDATE SET
             unjail_count = unjail_count + 1,
             rank_level = MIN(rank_level + 1, ?)`,
        )
        .run(guildId, userId, Math.min(1, rankCount), Math.max(0, rankCount));
      return this.getProgress(guildId, userId);
    });
    return transaction();
  }

  getProgress(guildId, userId) {
    return (
      this.db
        .prepare(
          "SELECT * FROM member_progress WHERE guild_id = ? AND user_id = ?",
        )
        .get(guildId, userId) ?? { unjail_count: 0, rank_level: 0 }
    );
  }

  close() {
    this.db.close();
  }
}
