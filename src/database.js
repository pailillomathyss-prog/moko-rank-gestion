import Database from "better-sqlite3";
import { RESET_INTERVAL_MS, RANKS } from "./ranks.js";

function mapGiveaway(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    hostId: row.host_id,
    prize: row.prize,
    winnerCount: row.winner_count,
    endsAt: row.ends_at,
    status: row.status,
    winnerIds: JSON.parse(row.winner_ids_json),
    resultAnnounced: Boolean(row.result_announced),
  };
}

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
        role_5 TEXT,
        rank_log_channel_id TEXT
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

      CREATE TABLE IF NOT EXISTS giveaways (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        host_id TEXT NOT NULL,
        prize TEXT NOT NULL,
        winner_count INTEGER NOT NULL,
        ends_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        winner_ids_json TEXT NOT NULL DEFAULT '[]',
        result_announced INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS giveaways_guild_status_end
        ON giveaways (guild_id, status, ends_at);

      CREATE TABLE IF NOT EXISTS giveaway_entries (
        giveaway_id TEXT NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (giveaway_id, user_id)
      );
    `);

    const guildConfigColumns = this.db
      .prepare("PRAGMA table_info(guild_config)")
      .all()
      .map((column) => column.name);
    if (!guildConfigColumns.includes("rank_log_channel_id")) {
      this.db.exec(
        "ALTER TABLE guild_config ADD COLUMN rank_log_channel_id TEXT"
      );
    }

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
    this.setRankLogChannelStatement = this.db.prepare(`
      UPDATE guild_config
      SET rank_log_channel_id = ?
      WHERE guild_id = ?
    `);
    this.insertGiveawayStatement = this.db.prepare(`
      INSERT INTO giveaways (
        id, guild_id, channel_id, host_id, prize, winner_count,
        ends_at, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.selectGiveawayStatement = this.db.prepare(
      "SELECT * FROM giveaways WHERE id = ?"
    );
    this.selectPendingGiveawaysStatement = this.db.prepare(`
      SELECT * FROM giveaways
      WHERE guild_id = ? AND status IN ('active', 'ending')
      ORDER BY ends_at ASC
    `);
    this.selectUnannouncedGiveawaysStatement = this.db.prepare(`
      SELECT * FROM giveaways
      WHERE guild_id = ? AND status = 'ended' AND result_announced = 0
    `);
    this.setGiveawayMessageStatement = this.db.prepare(`
      UPDATE giveaways SET message_id = ? WHERE id = ?
    `);
    this.markGiveawayEndingStatement = this.db.prepare(`
      UPDATE giveaways SET status = 'ending'
      WHERE id = ? AND status = 'active'
    `);
    this.completeGiveawayStatement = this.db.prepare(`
      UPDATE giveaways
      SET status = 'ended', winner_ids_json = ?
      WHERE id = ? AND status = 'ending'
    `);
    this.markGiveawayResultAnnouncedStatement = this.db.prepare(`
      UPDATE giveaways SET result_announced = 1 WHERE id = ?
    `);
    this.deleteGiveawayStatement = this.db.prepare(
      "DELETE FROM giveaways WHERE id = ?"
    );
    this.insertGiveawayEntryStatement = this.db.prepare(`
      INSERT INTO giveaway_entries (giveaway_id, user_id, joined_at)
      VALUES (?, ?, ?)
    `);
    this.deleteGiveawayEntryStatement = this.db.prepare(`
      DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?
    `);
    this.selectGiveawayEntryStatement = this.db.prepare(`
      SELECT user_id FROM giveaway_entries
      WHERE giveaway_id = ? AND user_id = ?
    `);
    this.selectGiveawayEntriesStatement = this.db.prepare(`
      SELECT user_id FROM giveaway_entries
      WHERE giveaway_id = ? ORDER BY joined_at ASC
    `);
    this.countGiveawayEntriesStatement = this.db.prepare(`
      SELECT COUNT(*) AS count FROM giveaway_entries WHERE giveaway_id = ?
    `);
    this.toggleGiveawayEntryTransaction = this.db.transaction(
      (giveawayId, userId) => {
        const giveaway = this.selectGiveawayStatement.get(giveawayId);
        if (
          !giveaway ||
          giveaway.status !== "active" ||
          giveaway.ends_at <= Date.now()
        ) {
          return { open: false, entered: false, count: 0 };
        }

        const exists = this.selectGiveawayEntryStatement.get(
          giveawayId,
          userId
        );
        if (exists) {
          this.deleteGiveawayEntryStatement.run(giveawayId, userId);
        } else {
          this.insertGiveawayEntryStatement.run(
            giveawayId,
            userId,
            Date.now()
          );
        }

        return {
          open: true,
          entered: !exists,
          count: this.countGiveawayEntriesStatement.get(giveawayId).count,
        };
      }
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
      rankLogChannelId: row.rank_log_channel_id ?? null,
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

  setRankLogChannel(guildId, channelId) {
    this.setRankLogChannelStatement.run(channelId, guildId);
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

  createGiveaway(giveaway, now = Date.now()) {
    this.insertGiveawayStatement.run(
      giveaway.id,
      giveaway.guildId,
      giveaway.channelId,
      giveaway.hostId,
      giveaway.prize,
      giveaway.winnerCount,
      giveaway.endsAt,
      now
    );
  }

  setGiveawayMessageId(giveawayId, messageId) {
    this.setGiveawayMessageStatement.run(messageId, giveawayId);
  }

  getGiveaway(giveawayId) {
    return mapGiveaway(this.selectGiveawayStatement.get(giveawayId));
  }

  getPendingGiveaways(guildId) {
    return this.selectPendingGiveawaysStatement
      .all(guildId)
      .map(mapGiveaway);
  }

  getUnannouncedGiveaways(guildId) {
    return this.selectUnannouncedGiveawaysStatement
      .all(guildId)
      .map(mapGiveaway);
  }

  toggleGiveawayEntry(giveawayId, userId) {
    return this.toggleGiveawayEntryTransaction(giveawayId, userId);
  }

  getGiveawayEntries(giveawayId) {
    return this.selectGiveawayEntriesStatement
      .all(giveawayId)
      .map((row) => row.user_id);
  }

  markGiveawayEnding(giveawayId) {
    return this.markGiveawayEndingStatement.run(giveawayId).changes > 0;
  }

  completeGiveaway(giveawayId, winnerIds) {
    return (
      this.completeGiveawayStatement.run(
        JSON.stringify(winnerIds),
        giveawayId
      ).changes > 0
    );
  }

  markGiveawayResultAnnounced(giveawayId) {
    this.markGiveawayResultAnnouncedStatement.run(giveawayId);
  }

  deleteGiveaway(giveawayId) {
    this.deleteGiveawayStatement.run(giveawayId);
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
