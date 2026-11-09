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
        embed = discord.Embed(
            title="🧩 À toi de deviner !", color=COLORS["question"],
            description=f"**{question.category}** · Tu as **{round_['duration']} secondes**.\n"
                        "Le premier à trouver remporte **1 point**. Réponds directement dans ce salon.",
        )
        embed.set_image(url="attachment://devinette.png")
        embed.set_footer(text=f"Devinette #{round_['id']} • Accents et majuscules ignorés")
        message = await channel.send(embed=embed, file=discord.File(io.BytesIO(png), filename="devinette.png"))
        return message.id, message.created_at.timestamp()

    async def result(self, result, question):
        channel = await self.channel(result["channel"])
        status = result["status"]
        if status == "won":
            elapsed = f"{result['elapsed']:.2f}".replace(".", ",")
            embed = discord.Embed(title="🎉 BRAVO !", color=COLORS[status],
                                  description=f"**{safe_name(result['winner_name'])}** a trouvé la bonne réponse !")
            embed.add_field(name="🧠 Réponse", value=question.answer, inline=False)
            embed.add_field(name="⏱️ Temps", value=f"{elapsed} secondes")
            embed.add_field(name="🏆 Points gagnés", value="**+1**")
            embed.add_field(name="⭐ Total", value=f"**{result['total']} points**")
        elif status == "expired":
            embed = discord.Embed(title="⌛ Temps écoulé !", color=COLORS[status],
                                  description=f"Personne n’a trouvé à temps.\n\n🧠 La réponse était : **{question.answer}**.")
        else:
            embed = discord.Embed(title="⏸️ Devinette interrompue", color=COLORS["cancelled"],
                                  description="La configuration du jeu a changé. Aucun point n’est attribué.")
        embed.set_footer(text=f"Devinette #{result['id']} • /points · /classement · /monrang")
        # Keep the image attachment. Editing this exact message is safe to retry.
        embed.set_image(url="attachment://devinette.png")
        try:
            await channel.get_partial_message(result["message_id"]).edit(embed=embed)
        except discord.NotFound:
            # Deleted messages cannot be edited. A replacement carries the same idempotency marker.
            marker = f"Résultat #{result['id']}"
            async for message in channel.history(limit=100):
                if message.author.id == self.client.user.id and any(e.footer.text == marker for e in message.embeds):
                    return
            embed.set_image(url=None)
            embed.set_footer(text=marker)
            await channel.send(embed=embed)


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
        self.ready_lock = asyncio.Lock()
        self.install_commands()
        self.tree.error(self.command_error)

    async def setup_hook(self):
        self.bank = await asyncio.to_thread(QuestionBank)
        await self.store.open()
        self.game = Engine(self.store, self.bank, DiscordTransport(self))
        self.worker = asyncio.create_task(self.maintenance())

    async def sync_guild(self, guild):
        try:
            self.tree.copy_global_to(guild=guild)
            await self.tree.sync(guild=guild)
            self.synced.add(guild.id)
            log.info("Commandes synchronisées pour le serveur %s.", guild.id)
        except discord.HTTPException:
            log.exception("Synchronisation des commandes impossible pour %s.", guild.id)

    async def on_ready(self):
        async with self.ready_lock:
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

    def install_commands(self):
        config = app_commands.Group(name="config", description="Configuration du jeu de devinettes.",
                                    default_permissions=discord.Permissions(administrator=True), guild_only=True)

        @config.command(name="salon", description="Choisir le salon textuel du jeu.")
        @app_commands.checks.has_permissions(administrator=True)
        @app_commands.describe(salon="Salon où compter les discussions et envoyer les devinettes.")
        async def salon(i: discord.Interaction, salon: discord.TextChannel):
            await i.response.defer(ephemeral=True)
            try:
                self.validate_channel(salon, i.guild)
            except ValueError as exc:
                return await i.followup.send(str(exc), ephemeral=True)
            await self.game.configure(i.guild_id, channel=salon.id)
            await i.followup.send(f"Salon configuré : {salon.mention}. Utilise `/config activer` pour démarrer.", ephemeral=True)

        @config.command(name="frequence", description="Messages nécessaires avant une devinette (15 par défaut).")
        @app_commands.checks.has_permissions(administrator=True)
        async def frequence(i: discord.Interaction, messages: app_commands.Range[int, 1, 1000]):
            await i.response.defer(ephemeral=True)
            await self.game.configure(i.guild_id, frequency=messages)
            await i.followup.send(f"Une devinette tous les **{messages} messages**. Compteur conservé.", ephemeral=True)

        @config.command(name="temps", description="Temps de réponse (20 secondes par défaut).")
        @app_commands.checks.has_permissions(administrator=True)
        async def temps(i: discord.Interaction, secondes: app_commands.Range[int, 5, 300]):
            await i.response.defer(ephemeral=True)
            await self.game.configure(i.guild_id, duration=secondes)
            await i.followup.send(f"Les prochaines devinettes dureront **{secondes} secondes**.", ephemeral=True)

        @config.command(name="activer", description="Activer les devinettes automatiques.")
        @app_commands.checks.has_permissions(administrator=True)
        async def activer(i: discord.Interaction):
            await i.response.defer(ephemeral=True)
            current = await self.store.settings(i.guild_id)
            if not current["channel"]:
                return await i.followup.send("Choisis d’abord `/config salon`.", ephemeral=True)
            try:
                channel = await self.game.transport.channel(current["channel"])
                self.validate_channel(channel, i.guild)
            except (ValueError, discord.HTTPException) as exc:
                return await i.followup.send(f"Salon inaccessible ou permissions insuffisantes ({type(exc).__name__}).", ephemeral=True)
            await self.game.configure(i.guild_id, enabled=1)
            await i.followup.send("✅ Jeu activé. Les prochaines discussions déclencheront les devinettes.", ephemeral=True)

        @config.command(name="desactiver", description="Désactiver le jeu sans effacer les points ni le compteur.")
        @app_commands.checks.has_permissions(administrator=True)
        async def desactiver(i: discord.Interaction):
            await i.response.defer(ephemeral=True)
            await self.game.configure(i.guild_id, enabled=0)
            await i.followup.send("⏸️ Jeu désactivé. Points et compteur conservés ; devinette en cours interrompue.", ephemeral=True)

        @config.command(name="statut", description="Afficher les réglages et le compteur actuels.")
        @app_commands.checks.has_permissions(administrator=True)
        async def statut(i: discord.Interaction):
            await i.response.defer(ephemeral=True)
            current = await self.store.settings(i.guild_id)
            active = await self.store.live(i.guild_id)
            embed = discord.Embed(title="⚙️ Jeu de devinettes", color=COLORS["question"])
            embed.add_field(name="État", value="Actif" if current["enabled"] else "En pause")
            embed.add_field(name="Salon", value=f"<#{current['channel']}>" if current["channel"] else "Non configuré")
            embed.add_field(name="Fréquence", value=f"{current['frequency']} messages")
            embed.add_field(name="Chronomètre", value=f"{current['duration']} secondes")
            embed.add_field(name="Compteur", value=f"{current['counter']} / {current['frequency']}")
            embed.add_field(name="Devinette", value="En cours" if active else "En attente")
            embed.set_footer(text="Les tentatives comptent aussi ; une seule devinette peut être active à la fois.")
            await i.followup.send(embed=embed, ephemeral=True)

        @self.tree.command(name="points", description="Afficher tes points ou ceux d’un membre.")
        @app_commands.guild_only()
        async def points(i: discord.Interaction, membre: discord.Member | None = None):
            await i.response.defer()
            target = membre or i.user
            total = await self.store.points(i.guild_id, target.id)
            await i.followup.send(embed=discord.Embed(title="⭐ Points",
                description=f"**{safe_name(target.display_name)}** : **{total} point{'s' if total != 1 else ''}**.", color=COLORS["won"]))

        @self.tree.command(name="classement", description="Afficher le top 10 des joueurs de ce serveur.")
        @app_commands.guild_only()
        async def classement(i: discord.Interaction):
            await i.response.defer()
            rows = await self.store.leaderboard(i.guild_id)
            lines = []
            for row in rows:
                member = i.guild.get_member(row["user"])
                name = member.display_name if member else row["name"]
                medal = {1: "🥇", 2: "🥈", 3: "🥉"}.get(row["position"], "🏅")
                lines.append(f"{medal} **{row['position']}.** {safe_name(name)} — **{row['points']} pts**")
            embed = discord.Embed(title="🏆 Top 10 du serveur",
                                  description="\n".join(lines) or "Aucun point pour le moment. La première victoire t’attend !",
                                  color=0xF1C75B)
            embed.set_footer(text="En cas d’égalité de points, les joueurs partagent le même rang.")
            await i.followup.send(embed=embed)

        @self.tree.command(name="monrang", description="Afficher ta position dans le classement.")
        @app_commands.guild_only()
        async def monrang(i: discord.Interaction):
            await i.response.defer(ephemeral=True)
            rank = await self.store.rank(i.guild_id, i.user.id)
            text = f"Tu es **n°{rank['position']}** avec **{rank['points']} points**." if rank else "Tu n’es pas encore classé. Trouve une devinette pour gagner ton premier point !"
            await i.followup.send(embed=discord.Embed(title="📊 Mon rang", description=text, color=COLORS["question"]), ephemeral=True)

        self.tree.add_command(config)

    async def close(self):
        if self.worker:
            self.worker.cancel()
            with suppress(asyncio.CancelledError):
                await self.worker
        await super().close()
        await self.store.close()
