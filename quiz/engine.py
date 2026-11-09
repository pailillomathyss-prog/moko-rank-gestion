"""Moteur indépendant de Discord pour tester les courses et les redémarrages."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import defaultdict

from .questions import Question

log = logging.getLogger(__name__)


class Engine:
    def __init__(self, store, bank, transport, clock=time.time):
        self.store, self.bank, self.transport, self.clock = store, bank, transport, clock
        self.locks = defaultdict(asyncio.Lock)
        self.retry_after = {}

    async def message(self, *, guild, channel, message_id, user, name, text, created, bot=False, command=False):
        if bot or command:
            return
        async with self.locks[guild]:
            config = await self.store.settings(guild)
            if not config["enabled"] or config["channel"] != channel:
                return
            if not await self.store.count_message(guild, message_id):
                return
            current = await self.store.live(guild)
            if current:
                # All human messages count; an active round defers the next launch.
                if current["status"] != "active" or created < current["started"]:
                    return
                if created > current["deadline"]:
                    await self.store.finish(current["id"])
                    await self._announce_guild(guild)
                    # This is a new discussion message after the deadline.
                else:
                    if Question.deserialize(current["question"]).matches(text):
                        result = await self.store.finish(current["id"], user=user, name=name, submitted=created)
                        if result:
                            await self._announce_guild(guild)
                            await self._start(guild)
                    return
            await self._start(guild)

    async def _start(self, guild):
        if self.clock() < self.retry_after.get(guild, 0):
            return
        config = await self.store.settings(guild)
        if not config["enabled"] or config["counter"] < config["frequency"] or await self.store.live(guild):
            return
        question = self.bank.choose(json.loads(config["recent"]))
        png = await asyncio.to_thread(question.image)
        current = await self.store.begin(guild, question)
        if not current:
            return
        sent = False
        try:
            message_id, started = await self.transport.question(current, question, png)
            sent = True
            await self.store.activate(current["id"], message_id, started, question.key)
        except Exception:
            log.exception("Envoi/activation de devinette impossible (serveur %s).", guild)
            await self.store.abort_send(current["id"], refund=not sent)
            self.retry_after[guild] = self.clock() + 30

    async def _announce_guild(self, guild):
        for result in await self.store.pending():
            if result["guild"] != guild:
                continue
            try:
                # Edit the original message: idempotent, no duplicate victory on retry.
                await self.transport.result(result, Question.deserialize(result["question"]))
                await self.store.mark_announced(result["id"])
            except Exception:
                log.exception("Annonce différée du résultat %s.", result["id"])

    async def tick(self):
        guilds = {r["guild"] for r in await self.store.enabled_guilds()}
        guilds.update(r["guild"] for r in await self.store.pending())
        for guild in guilds:
            async with self.locks[guild]:
                current = await self.store.live(guild)
                if current and current["status"] == "active" and self.clock() >= current["deadline"]:
                    await self.store.finish(current["id"])
                await self._announce_guild(guild)
                if not await self.store.live(guild):
                    await self._start(guild)

    async def configure(self, guild, **changes):
        async with self.locks[guild]:
            if "channel" in changes or changes.get("enabled") == 0:
                await self.store.cancel(guild)
            await self.store.configure(guild, **changes)
            await self._announce_guild(guild)

    async def recover(self):
        await self.store.recover_sending()
        await self.tick()
