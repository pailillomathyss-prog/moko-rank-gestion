export class ManagementStore {
  constructor(db) {
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS management_settings (
        guild_id TEXT PRIMARY KEY, config TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS management_cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL,
        target_id TEXT, actor_id TEXT NOT NULL, action TEXT NOT NULL,
        reason TEXT NOT NULL, created_at INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS management_cases_guild ON management_cases(guild_id, target_id);
    `);
  }
  get(guildId) {
    const row = this.db.prepare("SELECT config FROM management_settings WHERE guild_id=?").get(guildId);
    return row ? JSON.parse(row.config) : { roles: {}, commands: {}, logChannel: null };
  }
  save(guildId, config) {
    this.db.prepare(`INSERT INTO management_settings VALUES (?,?)
      ON CONFLICT(guild_id) DO UPDATE SET config=excluded.config`).run(guildId, JSON.stringify(config));
  }
  record(guildId, targetId, actorId, action, reason) {
    return this.db.prepare(`INSERT INTO management_cases
      (guild_id,target_id,actor_id,action,reason,created_at) VALUES (?,?,?,?,?,?)`)
      .run(guildId, targetId, actorId, action, reason, Date.now()).lastInsertRowid;
  }
  history(guildId, targetId, warnings = false) {
    return this.db.prepare(`SELECT * FROM management_cases WHERE guild_id=?
      AND target_id=? ${warnings ? "AND action='avertir' AND active=1" : ""}
      ORDER BY id DESC LIMIT 15`).all(guildId, targetId);
  }
  removeWarning(guildId, targetId, id) {
    return this.db.prepare(`UPDATE management_cases SET active=0
      WHERE guild_id=? AND target_id=? AND id=? AND action='avertir' AND active=1`)
      .run(guildId, targetId, id).changes;
  }
}
