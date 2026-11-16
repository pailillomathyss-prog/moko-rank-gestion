"""Adaptateur Discord : commandes slash, images attachées et résultats élégants."""
from __future__ import annotations

import asyncio
import io
import logging
import time
from contextlib import suppress

import discord
from discord import app_commands

from .engine import Engine
from .questions import QuestionBank
from .storage import Storage

log = logging.getLogger(__name__)
COLORS = {"question": 0x5865F2, "won": 0x2ECC91, "expired": 0xF4AE42, "cancelled": 0x8892A6}


def safe_name(value):
    return discord.utils.escape_markdown(discord.utils.escape_mentions(value))[:80]


class DiscordTransport:
    def __init__(self, client):
        self.client = client

    async def channel(self, channel_id):
        channel = self.client.get_channel(channel_id) or await self.client.fetch_channel(channel_id)
        if not isinstance(channel, discord.TextChannel):
            raise ValueError("Le salon de jeu doit être un salon textuel.")
        return channel

    async def question(self, round_, question, png):
        channel = await self.channel(round_["channel"])
        message = await channel.send(file=discord.File(io.BytesIO(png), filename="devinette.png"))
        return message.id, message.created_at.timestamp()

    async def result(self, result, question):
        channel = await self.channel(result["channel"])
        status = result["status"]
        if status == "won":
            elapsed = f"{result['elapsed']:.2f}".replace(".", ",")
            content = f"Bravo <@{result['winner']}> ! +1 en {elapsed} secondes. Total : {result['total']} points."
        elif status == "expired":
            content = f"Personne n’a trouvé à temps. La bonne réponse était : {question.answer}."
        else:
            content = "Devinette interrompue : la configuration a changé. Aucun point attribué."
        # A separate reply leaves the original image unchanged. Recover an already
        # delivered reply if a crash occurred before the SQLite acknowledgement.
        async for message in channel.history(after=discord.Object(id=result["message_id"]), limit=None):
            if (message.author.id == self.client.user.id and message.reference
                    and message.reference.message_id == result["message_id"]):
                return
        await channel.send(
            content,
            reference=discord.MessageReference(message_id=result["message_id"], channel_id=result["channel"], fail_if_not_exists=False),
            allowed_mentions=discord.AllowedMentions.none(),
        )


class QuizClient(discord.Client):
    def __init__(self, path):
        intents = discord.Intents.default()
        intents.message_content = True
        super().__init__(intents=intents, allowed_mentions=discord.AllowedMentions.none())
        self.tree = app_commands.CommandTree(self)
        self.store = Storage(path)
        self.bank = None
        self.game = None
        self.worker = None
        self.synced = set()
        self.global_commands_cleared = False
        self.ready_lock = asyncio.Lock()
        self.tree.error(self.command_error)

    async def setup_hook(self):
        self.bank = await asyncio.to_thread(QuestionBank)
        await self.store.open()
        self.game = Engine(self.store, self.bank, DiscordTransport(self))
        self.worker = asyncio.create_task(self.maintenance())

    async def clear_global_commands(self):
        """Remove every global application command from Discord."""
        self.tree.clear_commands(guild=None)
        try:
            remaining = await self.tree.sync()
            if remaining:
                raise RuntimeError("Discord a conservé des commandes globales inattendues.")
            self.global_commands_cleared = True
            log.info("Toutes les commandes globales du bot ont été supprimées.")
        except (discord.HTTPException, RuntimeError):
            log.exception("Suppression des commandes globales impossible ; nouvelle tentative au prochain démarrage.")

    async def sync_guild(self, guild):
        try:
            self.tree.clear_commands(guild=guild)
            registered = await self.tree.sync(guild=guild)
            if registered:
                raise RuntimeError("Discord a conservé des commandes de serveur inattendues.")
            self.synced.add(guild.id)
            log.info("Toutes les commandes du serveur %s ont été supprimées.", guild.id)
        except (discord.HTTPException, RuntimeError):
            log.exception("Synchronisation des commandes impossible pour %s.", guild.id)

    async def on_ready(self):
        async with self.ready_lock:
            if not self.global_commands_cleared:
                await self.clear_global_commands()
            for guild in self.guilds:
                if guild.id not in self.synced:
                    await self.sync_guild(guild)
            log.info("Bot de devinettes connecté (%s serveurs).", len(self.guilds))

    async def on_guild_join(self, guild):
        await self.sync_guild(guild)

    async def maintenance(self):
        await self.wait_until_ready()
        recovered = False
        while not self.is_closed():
            try:
                if self.is_ready():
                    if not recovered:
                        await self.game.recover()
                        recovered = True
                    else:
                        await self.game.tick()
            except Exception:
                log.exception("Vérification des devinettes : nouvelle tentative dans une seconde.")
            await asyncio.sleep(1)

    async def on_message(self, message):
        if not message.guild:
            return
        # Application commands do not produce ordinary MessageCreate events.
        # Also ignore typed command-like lines, webhook/system messages and bots.
        command = message.content.lstrip().startswith(("/", "!")) or message.is_system() or message.webhook_id is not None
        await self.game.message(
            guild=message.guild.id, channel=message.channel.id, message_id=message.id,
            user=message.author.id, name=message.author.display_name, text=message.content,
            created=message.created_at.timestamp(), bot=message.author.bot, command=command,
        )

    async def command_error(self, interaction, error):
        if isinstance(error, app_commands.MissingPermissions):
            text = "Cette commande est réservée aux administrateurs du serveur."
        elif isinstance(error, app_commands.NoPrivateMessage):
            text = "Cette commande doit être utilisée dans un serveur."
        elif isinstance(error, app_commands.CheckFailure):
            text = "Tu n’as pas les permissions nécessaires."
        else:
            log.error("Erreur commande %s : %s", interaction.command.name if interaction.command else "inconnue", type(error).__name__)
            text = "L’action n’a pas pu être effectuée. Vérifie les permissions du bot et les logs."
        if interaction.response.is_done():
            await interaction.followup.send(text, ephemeral=True)
        else:
            await interaction.response.send_message(text, ephemeral=True)

    @staticmethod
    def validate_channel(channel, guild):
        if channel.guild.id != guild.id:
            raise ValueError("Le salon doit appartenir à ce serveur.")
        permissions = channel.permissions_for(guild.me)
        required = ["view_channel", "send_messages", "embed_links", "attach_files", "read_message_history"]
        missing = [name for name in required if not getattr(permissions, name)]
        if missing:
            raise ValueError("Permissions manquantes dans le salon : " + ", ".join(missing))

    async def close(self):
        if self.worker:
            self.worker.cancel()
            with suppress(asyncio.CancelledError):
                await self.worker
        await super().close()
        await self.store.close()
