import Database from "better-sqlite3";

export class BotDatabase {
  constructor(filePath) {
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        staff_role_id TEXT,
        brigade_role_id TEXT,
        jail_role_id TEXT,
        jail_channel_id TEXT
      );
      CREATE TABLE IF NOT EXISTS jail_records (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        jailed_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS warnings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  ensureGuild(guildId) {
    this.db
      .prepare("INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)")
      .run(guildId);
    return this.getGuild(guildId);
  }

  getGuild(guildId) {
    return this.db
      .prepare("SELECT * FROM guild_settings WHERE guild_id = ?")
      .get(guildId);
  }

  setRole(guildId, key, roleId) {
    const allowed = {
      staff: "staff_role_id",
      brigade: "brigade_role_id",
      jail: "jail_role_id",
    };
    const column = allowed[key];
    if (!column) throw new Error("Unknown role setting.");
    this.db.prepare(`UPDATE guild_settings SET ${column} = ? WHERE guild_id = ?`)
      .run(roleId, guildId);
  }

  setJailChannel(guildId, channelId) {
    this.db
      .prepare("UPDATE guild_settings SET jail_channel_id = ? WHERE guild_id = ?")
      .run(channelId, guildId);
  }

  setJail(guildId, userId, reason, moderatorId) {
    this.db.prepare(`
      INSERT INTO jail_records (guild_id, user_id, reason, moderator_id, jailed_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (guild_id, user_id) DO UPDATE SET
        reason = excluded.reason,
        moderator_id = excluded.moderator_id,
        jailed_at = excluded.jailed_at
    `).run(guildId, userId, reason, moderatorId, Date.now());
  }

  getJail(guildId, userId) {
    return this.db
      .prepare("SELECT * FROM jail_records WHERE guild_id = ? AND user_id = ?")
      .get(guildId, userId) ?? null;
  }

  removeJail(guildId, userId) {
    return this.db
      .prepare("DELETE FROM jail_records WHERE guild_id = ? AND user_id = ?")
      .run(guildId, userId).changes > 0;
  }

  addWarning(guildId, userId, moderatorId, reason) {
    return this.db.prepare(`
      INSERT INTO warnings (guild_id, user_id, moderator_id, reason, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(guildId, userId, moderatorId, reason, Date.now()).lastInsertRowid;
  }

  getWarnings(guildId, userId) {
    return this.db.prepare(`
      SELECT id, moderator_id, reason, created_at
      FROM warnings
      WHERE guild_id = ? AND user_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `).all(guildId, userId);
  }

  clearWarnings(guildId, userId) {
    return this.db
      .prepare("DELETE FROM warnings WHERE guild_id = ? AND user_id = ?")
      .run(guildId, userId).changes;
  }
}
