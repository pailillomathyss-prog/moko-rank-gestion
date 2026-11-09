"""Transactions SQLite asynchrones : un round ne peut créditer qu'un gagnant."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import aiosqlite


class Storage:
    def __init__(self, path: str):
        self.path = path
        self.db = None
        self.lock = asyncio.Lock()

    async def open(self):
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.db = await aiosqlite.connect(self.path)
        self.db.row_factory = aiosqlite.Row
        await self.db.executescript("""
          PRAGMA journal_mode=WAL;
          PRAGMA busy_timeout=5000;
          CREATE TABLE IF NOT EXISTS settings (
            guild INTEGER PRIMARY KEY, channel INTEGER, frequency INTEGER NOT NULL DEFAULT 15,
            duration INTEGER NOT NULL DEFAULT 20, enabled INTEGER NOT NULL DEFAULT 0,
            counter INTEGER NOT NULL DEFAULT 0, recent TEXT NOT NULL DEFAULT '[]'
          );
          CREATE TABLE IF NOT EXISTS rounds (
            id INTEGER PRIMARY KEY AUTOINCREMENT, guild INTEGER NOT NULL, channel INTEGER NOT NULL,
            question TEXT NOT NULL, duration INTEGER NOT NULL, cost INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'sending',
            message_id INTEGER, started REAL, deadline REAL, winner INTEGER, winner_name TEXT,
            elapsed REAL, total INTEGER, announced INTEGER NOT NULL DEFAULT 0
          );
          CREATE UNIQUE INDEX IF NOT EXISTS one_live_round ON rounds(guild)
            WHERE status IN ('sending','active');
          CREATE TABLE IF NOT EXISTS scores (
            guild INTEGER, user INTEGER, name TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(guild,user)
          );
          CREATE TABLE IF NOT EXISTS seen_messages (
            id INTEGER PRIMARY KEY, guild INTEGER NOT NULL
          );
        """)
        await self.db.commit()
        return self

    async def _one(self, sql, values=()):
        async with self.db.execute(sql, values) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None

    async def _all(self, sql, values=()):
        async with self.db.execute(sql, values) as cursor:
            return [dict(row) for row in await cursor.fetchall()]

    async def _ensure(self, guild):
        await self.db.execute("INSERT OR IGNORE INTO settings(guild) VALUES (?)", (guild,))

    async def settings(self, guild):
        async with self.lock:
            await self._ensure(guild)
            await self.db.commit()
            return await self._one("SELECT * FROM settings WHERE guild=?", (guild,))

    async def configure(self, guild, **changes):
        allowed = {"channel", "frequency", "duration", "enabled"}
        if not changes or not changes.keys() <= allowed:
            raise ValueError("Paramètres de configuration invalides.")
        async with self.lock:
            await self._ensure(guild)
            await self.db.execute(
                "UPDATE settings SET " + ", ".join(f"{k}=?" for k in changes) + " WHERE guild=?",
                (*changes.values(), guild),
            )
            await self.db.commit()

    async def count_message(self, guild, message_id):
        async with self.lock:
            try:
                cursor = await self.db.execute("INSERT OR IGNORE INTO seen_messages VALUES (?,?)", (message_id, guild))
                if cursor.rowcount:
                    await self.db.execute("UPDATE settings SET counter=counter+1 WHERE guild=?", (guild,))
                await self.db.commit()
                return bool(cursor.rowcount)
            except BaseException:
                await self.db.rollback()
                raise

    async def live(self, guild):
        async with self.lock:
            return await self._one("SELECT * FROM rounds WHERE guild=? AND status IN ('sending','active')", (guild,))

    async def begin(self, guild, question):
        async with self.lock:
            try:
                await self.db.execute("BEGIN IMMEDIATE")
                config = await self._one("SELECT * FROM settings WHERE guild=?", (guild,))
                live = await self._one("SELECT id FROM rounds WHERE guild=? AND status IN ('sending','active')", (guild,))
                if not config or not config["enabled"] or not config["channel"] or live or config["counter"] < config["frequency"]:
                    await self.db.rollback()
                    return None
                cursor = await self.db.execute(
                    "INSERT INTO rounds(guild,channel,question,duration,cost) VALUES (?,?,?,?,?)",
                    (guild, config["channel"], question.serialize(), config["duration"], config["frequency"]),
                )
                await self.db.commit()
                return await self._one("SELECT * FROM rounds WHERE id=?", (cursor.lastrowid,))
            except BaseException:
                await self.db.rollback()
                raise

    async def activate(self, round_id, message_id, started, question_key):
        async with self.lock:
            try:
                round_ = await self._one("SELECT * FROM rounds WHERE id=?", (round_id,))
                await self.db.execute(
                    "UPDATE rounds SET status='active',message_id=?,started=?,deadline=? WHERE id=? AND status='sending'",
                    (message_id, started, started + round_["duration"], round_id),
                )
                config = await self._one("SELECT recent FROM settings WHERE guild=?", (round_["guild"],))
                recent = (json.loads(config["recent"]) + [question_key])[-10:]
                await self.db.execute("UPDATE settings SET recent=?,counter=MAX(0,counter-?) WHERE guild=?",
                                      (json.dumps(recent), round_["cost"], round_["guild"]))
                await self.db.commit()
            except BaseException:
                await self.db.rollback()
                raise

    async def abort_send(self, round_id, refund):
        async with self.lock:
            try:
                round_ = await self._one("SELECT * FROM rounds WHERE id=? AND status='sending'", (round_id,))
                if round_:
                    await self.db.execute("UPDATE rounds SET status='cancelled',announced=1 WHERE id=?", (round_id,))
                await self.db.commit()
            except BaseException:
                await self.db.rollback()
                raise

    async def finish(self, round_id, *, user=None, name=None, submitted=None):
        async with self.lock:
            try:
                await self.db.execute("BEGIN IMMEDIATE")
                round_ = await self._one("SELECT * FROM rounds WHERE id=? AND status='active'", (round_id,))
                if not round_ or (user is not None and not (round_["started"] <= submitted <= round_["deadline"])):
                    await self.db.rollback()
                    return None
                total = None
                if user is not None:
                    await self.db.execute(
                        """INSERT INTO scores VALUES (?,?,?,1) ON CONFLICT(guild,user)
                        DO UPDATE SET points=points+1,name=excluded.name""", (round_["guild"], user, name),
                    )
                    score = await self._one("SELECT points FROM scores WHERE guild=? AND user=?", (round_["guild"], user))
                    total = score["points"]
                await self.db.execute(
                    "UPDATE rounds SET status=?,winner=?,winner_name=?,elapsed=?,total=? WHERE id=?",
                    ("won" if user is not None else "expired", user, name,
                     submitted - round_["started"] if user is not None else None, total, round_id),
                )
                await self.db.commit()
                return await self._one("SELECT * FROM rounds WHERE id=?", (round_id,))
            except BaseException:
                await self.db.rollback()
                raise

    async def cancel(self, guild):
        async with self.lock:
            await self.db.execute("UPDATE rounds SET status='cancelled' WHERE guild=? AND status='active'", (guild,))
            await self.db.commit()

    async def pending(self):
        async with self.lock:
            return await self._all("SELECT * FROM rounds WHERE status IN ('won','expired','cancelled') AND announced=0 AND message_id IS NOT NULL")

    async def mark_announced(self, round_id):
        async with self.lock:
            await self.db.execute("UPDATE rounds SET announced=1 WHERE id=?", (round_id,))
            await self.db.commit()

    async def recover_sending(self):
        # Unknown HTTP outcome at crash: do not risk a duplicate question/point.
        async with self.lock:
            await self.db.execute("UPDATE rounds SET status='cancelled',announced=1 WHERE status='sending'")
            await self.db.commit()

    async def enabled_guilds(self):
        async with self.lock:
            return await self._all("SELECT guild FROM settings WHERE enabled=1")

    async def points(self, guild, user):
        async with self.lock:
            row = await self._one("SELECT points FROM scores WHERE guild=? AND user=?", (guild, user))
            return row["points"] if row else 0

    async def leaderboard(self, guild, limit=10):
        async with self.lock:
            return await self._all(
                """SELECT user,name,points,RANK() OVER (ORDER BY points DESC) position
                FROM scores WHERE guild=? ORDER BY points DESC,user ASC LIMIT ?""", (guild, limit))

    async def rank(self, guild, user):
        async with self.lock:
            return await self._one(
                """SELECT * FROM (SELECT user,points,RANK() OVER (ORDER BY points DESC) position
                FROM scores WHERE guild=?) WHERE user=?""", (guild, user))

    async def close(self):
        if self.db:
            await self.db.close()
