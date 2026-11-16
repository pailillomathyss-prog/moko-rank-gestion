"""Bot Discord de gestion : commandes préfixées, données locales et panneaux."""
from __future__ import annotations

import asyncio
import json
import logging
import random
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import discord
from discord.ext import commands, tasks

log = logging.getLogger(__name__)
PREFIX = "+"
DATA_FILES = {
    "warns": "warns.json",
    "giveaways": "giveaways.json",
    "ranks": "ranks.json",
    "autorole": "autorole.json",
    "owners": "owners.json",
}

HELP_PAGES = {
    "mod": ("Modération", 0xFF3030, [
        ("+clear <n>", "Supprime de 1 à 99 messages récents (défaut : 10)."),
        ("+kick @membre [raison]", "Expulse un membre."),
        ("+ban @membre [raison]", "Bannit un membre."),
        ("+unban <ID>", "Débannit par identifiant."),
        ("+mute @membre [minutes]", "Met en sourdine (défaut : 10 min)."),
        ("+unmute @membre", "Retire la mise en sourdine."),
    ]),
    "warn": ("Avertissements", 0xFFA500, [
        ("+warn @membre [raison]", "Ajoute un avertissement."),
        ("+unwarn @membre <ID>", "Retire un avertissement."),
        ("+warns @membre", "Affiche les avertissements."),
        ("+clearwarns @membre", "Efface ses avertissements (admin)."),
    ]),
    "channels": ("Salons", 0x00A86B, [
        ("+lock / +unlock", "Verrouille ou déverrouille le salon."),
        ("+slowmode <secondes>", "Règle le mode lent (0–21600)."),
        ("+hide / +show", "Masque ou affiche le salon."),
        ("+nuke", "Recrée le salon (admin)."),
    ]),
    "info": ("Informations", 0x3578E5, [
        ("+serverinfo", "Informations sur le serveur."),
        ("+userinfo [@membre]", "Informations sur un membre."),
        ("+botinfo", "État et latence du bot."),
        ("+ping", "Mesure la latence."),
    ]),
    "giveaway": ("Giveaways", 0xFFD700, [
        ("+gstart <durée> <gagnants> <prix>", "Lance un tirage, par exemple : +gstart 2h 1 Nitro."),
        ("+gend <ID>", "Termine un giveaway."),
        ("+greroll <ID>", "Tire un autre gagnant."),
        ("+gpanel", "Ouvre le panneau de création."),
    ]),
    "rank": ("Niveaux", 0x8A2BE2, [
        ("+rank [@membre]", "Affiche la carte de niveau."),
        ("+leaderboard", "Affiche les dix premiers."),
        ("+setlevel @membre <niveau>", "Règle un niveau (admin)."),
        ("+resetrank @membre", "Réinitialise un rang (admin)."),
    ]),
    "autorole": ("Rôle automatique", 0x008080, [
        ("+autorole @rôle", "Attribue un rôle aux nouveaux membres."),
        ("+autorole", "Affiche le rôle actuel."),
        ("+autoroleoff", "Désactive le rôle automatique."),
    ]),
    "roles": ("Rôles", 0x006400, [
        ("+addrole @membre @rôle", "Ajoute un rôle (Manage Roles)."),
        ("+removerole @membre @rôle", "Retire un rôle (Manage Roles)."),
    ]),
    "owner": ("Propriétaires du bot", 0x6A5ACD, [
        ("+own @membre", "Ajoute un propriétaire au bot (réservé aux propriétaires)."),
    ]),
}


def parse_duration(value: str) -> int | None:
    match = re.fullmatch(r"\s*(\d+)\s*([smhd])\s*", value, re.IGNORECASE)
    if not match:
        return None
    multiplier = {"s": 1, "m": 60, "h": 3600, "d": 86400}[match.group(2).lower()]
    seconds = int(match.group(1)) * multiplier
    return seconds if 1 <= seconds <= 365 * 86400 else None


def xp_for_level(level: int) -> int:
    return 5 * level**2 + 50 * level + 100


def normalize_id(value: int | str) -> str:
    return str(value)


def sanitize(value: str, limit: int = 300) -> str:
    return str(value).replace("@", "@\u200b")[:limit]


def embed(title: str, description: str, color: int = 0x7289DA) -> discord.Embed:
    return discord.Embed(title=sanitize(title, 256), description=description[:4000] or "—", color=color)


class BotData:
    """JSON local et réinitialisation unique, confirmée par le propriétaire."""

    def __init__(self, directory: Path):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.marker = self.directory / ".bot-reset-v1"
        if not self.marker.exists():
            self._reset_once()
        self.warns = self._load("warns")
        self.giveaways = self._load("giveaways")
        self.ranks = self._load("ranks")
        self.autorole = self._load("autorole")
        self.owners = self._load("owners")

    def _write(self, name: str, value: dict):
        path = self.directory / DATA_FILES[name]
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(path)

    def _load(self, name: str) -> dict:
        path = self.directory / DATA_FILES[name]
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(value, dict):
                return value
            log.error("%s doit contenir un objet JSON; données ignorées.", path.name)
        except FileNotFoundError:
            pass
        except (json.JSONDecodeError, OSError):
            log.exception("Impossible de lire %s; démarrage avec une banque vide.", path.name)
        return {}

    def save(self, name: str):
        self._write(name, getattr(self, name))

    def _reset_once(self):
        for filename in (*DATA_FILES.values(), "quiz.sqlite", "quiz.sqlite-wal", "quiz.sqlite-shm"):
            target = self.directory / filename
            if target.exists():
                target.unlink()
        for name in DATA_FILES:
            self._write(name, {})
        self.marker.write_text("Réinitialisation initiale terminée.\n", encoding="utf-8")


def rank_key(guild_id: int | str, user_id: int | str) -> str:
    return f"{guild_id}:{user_id}"


def format_help(category: str | None = None) -> discord.Embed:
    if category in HELP_PAGES:
        title, color, items = HELP_PAGES[category]
        card = discord.Embed(title=f"Aide — {title}", color=color)
        for name, description in items:
            card.add_field(name=f"`{name}`", value=description, inline=False)
        return card
    body = "Préfixe : `+`\n" + "\n".join(
        f"• {title} : `+help {key}`" for key, (title, _, _) in HELP_PAGES.items()
    )
    return embed("Supreme Bot — Aide", body)


class HelpSelect(discord.ui.Select):
    def __init__(self, custom_id: str = "help:select"):
        options = [
            discord.SelectOption(label=title, value=key, description=f"Commandes {title.lower()}")
            for key, (title, _, _) in HELP_PAGES.items()
        ]
        super().__init__(placeholder="Choisis une catégorie…", min_values=1, max_values=1,
                         options=options, custom_id=custom_id)

    async def callback(self, interaction: discord.Interaction):
        await interaction.response.edit_message(embed=format_help(self.values[0]), view=self.view)


class HelpView(discord.ui.View):
    def __init__(self, custom_id: str = "help:select"):
        super().__init__(timeout=180)
        self.add_item(HelpSelect(custom_id))


class GiveawayJoinView(discord.ui.View):
    def __init__(self, bot: "ManagementBot", giveaway_id: str):
        super().__init__(timeout=None)
        self.bot = bot
        self.giveaway_id = giveaway_id
        button = discord.ui.Button(
            label="Participer", style=discord.ButtonStyle.success,
            custom_id=f"giveaway:join:{giveaway_id}",
        )
        button.callback = self.join
        self.add_item(button)

    async def join(self, interaction: discord.Interaction):
        if interaction.guild_id is None:
            return await interaction.response.send_message("Utilise ce bouton dans le serveur du giveaway.", ephemeral=True)
        giveaway = self.bot.get_giveaway(interaction.guild_id, self.giveaway_id)
        if not giveaway or giveaway.get("ended"):
            return await interaction.response.send_message("Ce giveaway est terminé.", ephemeral=True)
        if int(giveaway["end_time"]) <= int(time.time()):
            await self.bot.finish_giveaway(giveaway)
            return await interaction.response.send_message("La période de participation est terminée.", ephemeral=True)
        participant = str(interaction.user.id)
        if participant in giveaway["participants"]:
            return await interaction.response.send_message("Tu participes déjà.", ephemeral=True)
        giveaway["participants"].append(participant)
        self.bot.data.save("giveaways")
        await interaction.response.send_message("Participation enregistrée !", ephemeral=True)


class CreateGiveawayModal(discord.ui.Modal, title="Créer un giveaway"):
    duration = discord.ui.TextInput(label="Durée (10m, 2h, 1d)", max_length=20)
    winners = discord.ui.TextInput(label="Nombre de gagnants (1–20)", max_length=2)
    prize = discord.ui.TextInput(label="Prix", max_length=200)

    def __init__(self, bot: "ManagementBot"):
        super().__init__(timeout=180)
        self.bot = bot

    async def on_submit(self, interaction: discord.Interaction):
        if not interaction.guild or not interaction.channel:
            return await interaction.response.send_message("Le giveaway doit être créé dans un serveur.", ephemeral=True)
        if not await self.bot.has_admin_user(interaction.guild, interaction.user):
            return await interaction.response.send_message("Cette action est réservée aux administrateurs.", ephemeral=True)
        winners = self.bot.parse_integer(str(self.winners.value), 1, 20)
        seconds = parse_duration(str(self.duration.value))
        prize = str(self.prize.value).strip()
        if seconds is None or winners is None or not prize:
            return await interaction.response.send_message("Durée, nombre de gagnants ou prix invalide.", ephemeral=True)
        giveaway = await self.bot.create_giveaway(interaction.channel, interaction.user.id, prize, seconds, winners)
        await interaction.response.send_message(f"Giveaway créé. ID : `{giveaway['id']}`.", ephemeral=True)


class GiveawayPanelView(discord.ui.View):
    def __init__(self, bot: "ManagementBot"):
        super().__init__(timeout=180)
        self.bot = bot
        button = discord.ui.Button(label="Créer un giveaway", style=discord.ButtonStyle.success)
        button.callback = self.create
        self.add_item(button)

    async def create(self, interaction: discord.Interaction):
        if not interaction.guild or not await self.bot.has_admin_user(interaction.guild, interaction.user):
            return await interaction.response.send_message("Cette action est réservée aux administrateurs.", ephemeral=True)
        await interaction.response.send_modal(CreateGiveawayModal(self.bot))


async def admin_or_bot_owner(ctx: commands.Context) -> bool:
    return await ctx.bot.has_admin_access(ctx)


def require_permission_or_owner(permission: str):
    async def predicate(ctx: commands.Context) -> bool:
        if await ctx.bot.has_admin_access(ctx):
            return True
        if getattr(ctx.author.guild_permissions, permission, False):
            return True
        raise commands.MissingPermissions([permission])
    return commands.check(predicate)


async def existing_bot_owner(ctx: commands.Context) -> bool:
    if await ctx.bot.is_bot_owner(ctx.author):
        return True
    raise commands.NotOwner("Seul un propriétaire du bot peut ajouter un propriétaire.")


class ManagementBot(commands.Bot):
    def __init__(self, data_directory: Path):
        intents = discord.Intents.default()
        intents.guilds = True
        intents.members = True
        intents.messages = True
        intents.message_content = True
        super().__init__(command_prefix=commands.when_mentioned_or(PREFIX), intents=intents, help_command=None)
        self.data_directory = Path(data_directory)
        self.data: BotData | None = None
        self._slash_commands_cleared = False
        self._slash_guilds_cleared: set[int] = set()
        self.xp_cooldowns: dict[str, float] = {}
        for base in reversed(type(self).__mro__):
            for name, descriptor in base.__dict__.items():
                if isinstance(descriptor, commands.Command):
                    bound = getattr(self, name)
                    if isinstance(bound, commands.Command):
                        self.add_command(bound)

    async def is_bot_owner(self, user: discord.User | discord.Member) -> bool:
        if str(user.id) in self.data.owners.get("ids", []):
            return True
        try:
            return await self.is_owner(user)
        except discord.HTTPException:
            log.exception("Impossible de vérifier le propriétaire de l’application Discord.")
            return False

    async def has_admin_access(self, ctx: commands.Context) -> bool:
        if ctx.guild is None:
            return False
        return await self.has_admin_user(ctx.guild, ctx.author)

    async def has_admin_user(self, guild: discord.Guild, user: discord.User | discord.Member) -> bool:
        if guild.owner_id == user.id:
            return True
        if getattr(getattr(user, "guild_permissions", None), "administrator", False):
            return True
        return await self.is_bot_owner(user)

    async def setup_hook(self):
        self.data = BotData(self.data_directory)
        for guild_id, giveaway in self.iter_active_giveaways():
            message_id = giveaway.get("message_id")
            if message_id:
                self.add_view(GiveawayJoinView(self, giveaway["id"]), message_id=int(message_id))
        self.giveaway_sweeper.start()

    async def on_ready(self):
        log.info("Bot connecté : %s (%s serveur(s)).", self.user, len(self.guilds))
        await self.clear_slash_commands()

    async def on_guild_join(self, guild: discord.Guild):
        await self.clear_guild_commands(guild)

    async def clear_slash_commands(self):
        if self._slash_commands_cleared:
            return
        self.tree.clear_commands(guild=None)
        await self.tree.sync()
        for guild in self.guilds:
            await self.clear_guild_commands(guild)
        self._slash_commands_cleared = True
        log.info("Toutes les anciennes commandes slash ont été supprimées.")

    async def clear_guild_commands(self, guild: discord.Guild):
        if guild.id in self._slash_guilds_cleared:
            return
        self.tree.clear_commands(guild=guild)
        await self.tree.sync(guild=guild)
        self._slash_guilds_cleared.add(guild.id)

    async def close(self):
        if self.giveaway_sweeper.is_running():
            self.giveaway_sweeper.cancel()
        await super().close()

    def get_giveaway(self, guild_id: int, giveaway_id: str) -> dict | None:
        return self.data.giveaways.get(f"{guild_id}:{giveaway_id}")

    def iter_active_giveaways(self):
        if not self.data:
            return
        for giveaway in self.data.giveaways.values():
            if not giveaway.get("ended"):
                yield int(giveaway["guild_id"]), giveaway

    @staticmethod
    def parse_integer(value: str, minimum: int, maximum: int) -> int | None:
        if not re.fullmatch(r"-?\d+", value.strip()):
            return None
        parsed = int(value)
        return parsed if minimum <= parsed <= maximum else None

    async def create_giveaway(self, channel, host_id: int, prize: str, seconds: int, winners: int) -> dict:
        giveaway_id = f"{int(time.time() * 1000)}-{random.randrange(36**5):05x}"
        giveaway = {
            "id": giveaway_id,
            "guild_id": str(channel.guild.id),
            "channel_id": str(channel.id),
            "host_id": str(host_id),
            "prize": sanitize(prize, 200),
            "winners": winners,
            "end_time": int(time.time()) + seconds,
            "participants": [],
            "winner_ids": [],
            "ended": False,
        }
        message = await channel.send(
            embed=embed(
                "🎉 Giveaway",
                f"**Prix :** {giveaway['prize']}\n**Gagnants :** {winners}\n"
                f"**Fin :** <t:{giveaway['end_time']}:R>\n**ID :** `{giveaway_id}`",
                0xFFD700,
            ),
            view=GiveawayJoinView(self, giveaway_id),
        )
        giveaway["message_id"] = str(message.id)
        self.data.giveaways[f"{channel.guild.id}:{giveaway_id}"] = giveaway
        self.data.save("giveaways")
        return giveaway

    async def finish_giveaway(self, giveaway: dict):
        if giveaway.get("ended"):
            return
        giveaway["ended"] = True
        self.data.save("giveaways")
        channel = self.get_channel(int(giveaway["channel_id"]))
        if channel is None:
            try:
                channel = await self.fetch_channel(int(giveaway["channel_id"]))
            except discord.HTTPException:
                log.warning("Salon du giveaway %s inaccessible.", giveaway["id"])
                return
        participants = list(dict.fromkeys(giveaway["participants"]))
        count = min(int(giveaway["winners"]), len(participants))
        winners = random.sample(participants, count) if count else []
        giveaway["winner_ids"] = winners
        self.data.save("giveaways")
        if winners:
            content = (
                f"Giveaway **{sanitize(giveaway['prize'], 200)}** terminé ! "
                f"Gagnant(s) : {', '.join(f'<@{uid}>' for uid in winners)}"
            )
            mentions = discord.AllowedMentions(users=[discord.Object(id=int(uid)) for uid in winners])
        else:
            content = f"Giveaway **{sanitize(giveaway['prize'], 200)}** terminé : aucun participant."
            mentions = discord.AllowedMentions.none()
        await channel.send(content, allowed_mentions=mentions)
        try:
            message = await channel.fetch_message(int(giveaway["message_id"]))
            await message.edit(view=None)
        except (discord.HTTPException, AttributeError, KeyError):
            pass

    @tasks.loop(seconds=30)
    async def giveaway_sweeper(self):
        if not self.data:
            return
        now = int(time.time())
        for giveaway in list(self.data.giveaways.values()):
            if not giveaway.get("ended") and int(giveaway["end_time"]) <= now:
                try:
                    await self.finish_giveaway(giveaway)
                except discord.HTTPException:
                    log.exception("Impossible de terminer le giveaway %s.", giveaway["id"])

    @giveaway_sweeper.before_loop
    async def before_giveaway_sweeper(self):
        await self.wait_until_ready()

    async def on_member_join(self, member: discord.Member):
        role_id = self.data.autorole.get(str(member.guild.id))
        role = member.guild.get_role(int(role_id)) if role_id else None
        if role and not role.managed and role < member.guild.me.top_role:
            await member.add_roles(role, reason="Rôle automatique")

    async def on_message(self, message: discord.Message):
        if not message.guild or message.author.bot or message.webhook_id:
            return
        await self.process_commands(message)
        if message.content.startswith(PREFIX):
            return
        key = rank_key(message.guild.id, message.author.id)
        now = time.monotonic()
        if now - self.xp_cooldowns.get(key, 0) < 60:
            return
        self.xp_cooldowns[key] = now
        data = self.data.ranks.setdefault(key, {"xp": 0, "level": 1, "messages": 0})
        data["xp"] += random.randint(15, 25)
        data["messages"] += 1
        leveled_up = False
        while data["xp"] >= xp_for_level(data["level"]):
            data["xp"] -= xp_for_level(data["level"])
            data["level"] += 1
            leveled_up = True
        self.data.save("ranks")
        if leveled_up:
            await message.channel.send(f"{message.author.mention} passe au **niveau {data['level']}** !")

    async def on_command_error(self, ctx: commands.Context, error: commands.CommandError):
        if isinstance(error, commands.CommandNotFound):
            return
        if isinstance(error, commands.NotOwner):
            return await ctx.reply("Seul le propriétaire du bot peut modifier ses propriétaires.", mention_author=False)
        if isinstance(error, commands.CommandInvokeError) and isinstance(error.original, discord.Forbidden):
            return await ctx.reply(
                "Cette action manque de permissions côté bot. Vérifie les permissions Discord du bot "
                "et place son rôle au-dessus des rôles qu’il doit gérer.",
                mention_author=False,
            )
        if isinstance(error, commands.BotMissingPermissions):
            missing = ", ".join(error.missing_permissions)
            return await ctx.reply(
                f"Il manque des permissions Discord au bot ({missing}). Vérifie ses permissions "
                "et la position de son rôle.",
                mention_author=False,
            )
        if isinstance(error, commands.MissingPermissions):
            return await ctx.reply("Tu n’as pas les permissions nécessaires.", mention_author=False)
        if isinstance(error, commands.NoPrivateMessage):
            return await ctx.reply("Cette commande doit être utilisée dans un serveur.", mention_author=False)
        if isinstance(error, commands.CheckFailure):
            return await ctx.reply("Cette commande est réservée aux administrateurs ou propriétaires autorisés.", mention_author=False)
        if isinstance(error, commands.MissingRequiredArgument):
            return await ctx.reply(f"Argument manquant : `{error.param.name}`.", mention_author=False)
        if isinstance(error, commands.BadArgument):
            return await ctx.reply("Argument invalide. Vérifie les mentions, identifiants et durées.", mention_author=False)
        log.exception("Erreur de commande %s.", getattr(ctx.command, "qualified_name", "inconnue"), exc_info=error)
        await ctx.reply("La commande a échoué. Vérifie mes permissions et les logs.", mention_author=False)

    @commands.command(name="help", aliases=["h"])
    async def help_text_command(self, ctx: commands.Context, category: str | None = None):
        category = category.lower() if category else None
        view = HelpView()
        await ctx.reply(embed=format_help(category), view=view, mention_author=False)

    @commands.command(name="panel")
    @commands.check(admin_or_bot_owner)
    @commands.guild_only()
    async def panel_command(self, ctx: commands.Context):
        await ctx.reply(
            embed=embed("Supreme Bot — Panneau de gestion", "Choisis une catégorie dans le menu ci-dessous."),
            view=HelpView("panel:select"),
            mention_author=False,
        )

    @commands.command(name="autorole")
    @commands.check(admin_or_bot_owner)
    @commands.guild_only()
    async def autorole_command(self, ctx: commands.Context, role: discord.Role | None = None):
        key = str(ctx.guild.id)
        if role is None:
            current = self.data.autorole.get(key)
            return await ctx.reply(
                f"Rôle actuel : <@&{current}>" if current else "Aucun rôle automatique. Utilise `+autorole @rôle`.",
                mention_author=False,
            )
        if role.managed or role >= ctx.guild.me.top_role:
            return await ctx.reply("Je ne peux pas attribuer un rôle géré ou supérieur au mien.", mention_author=False)
        self.data.autorole[key] = str(role.id)
        self.data.save("autorole")
        await ctx.reply(f"Rôle automatique défini sur {role.mention}.", mention_author=False)

    @commands.command(name="autoroleoff")
    @commands.check(admin_or_bot_owner)
    @commands.guild_only()
    async def autoroleoff_command(self, ctx: commands.Context):
        self.data.autorole.pop(str(ctx.guild.id), None)
        self.data.save("autorole")
        await ctx.reply("Rôle automatique désactivé.", mention_author=False)

    @commands.command(name="addrole")
    @require_permission_or_owner("manage_roles")
    @commands.guild_only()
    async def addrole_command(self, ctx: commands.Context, member: discord.Member, role: discord.Role):
        if role.managed or role >= ctx.guild.me.top_role or role >= ctx.author.top_role:
            return await ctx.reply("Je ne peux pas attribuer ce rôle à cause de sa position.", mention_author=False)
        if role in member.roles:
            return await ctx.reply(f"{member.mention} possède déjà ce rôle.", mention_author=False)
        await member.add_roles(role, reason=f"Ajouté par {ctx.author}")
        await ctx.reply(f"Rôle {role.mention} ajouté à {member.mention}.", mention_author=False)

    @commands.command(name="removerole")
    @require_permission_or_owner("manage_roles")
    @commands.guild_only()
    async def removerole_command(self, ctx: commands.Context, member: discord.Member, role: discord.Role):
        if role.managed or role >= ctx.guild.me.top_role or role >= ctx.author.top_role:
            return await ctx.reply("Je ne peux pas retirer ce rôle à cause de sa position.", mention_author=False)
        if role not in member.roles:
            return await ctx.reply(f"{member.mention} ne possède pas ce rôle.", mention_author=False)
        await member.remove_roles(role, reason=f"Retiré par {ctx.author}")
        await ctx.reply(f"Rôle {role.mention} retiré à {member.mention}.", mention_author=False)

    @commands.command(name="clear")
    @require_permission_or_owner("manage_messages")
    @commands.guild_only()
    async def clear_command(self, ctx: commands.Context, amount: int = 10):
        if not 1 <= amount <= 99:
            return await ctx.reply("Choisis un nombre de messages entre 1 et 99.", mention_author=False)
        deleted = await ctx.channel.purge(limit=amount + 1, bulk=True)
        notice = await ctx.send(f"🧹 {max(0, len(deleted) - 1)} message(s) supprimé(s).")
        await asyncio.sleep(4)
        await notice.delete()

    @commands.command(name="kick")
    @require_permission_or_owner("kick_members")
    @commands.guild_only()
    async def kick_command(self, ctx: commands.Context, member: discord.Member, *, reason: str = "Aucune raison"):
        if member == ctx.guild.owner or member.top_role >= ctx.guild.me.top_role:
            return await ctx.reply("La hiérarchie des rôles ne me permet pas cette expulsion.", mention_author=False)
        if member.top_role >= ctx.author.top_role and not await self.has_admin_access(ctx):
            return await ctx.reply("La hiérarchie des rôles ne me permet pas cette expulsion.", mention_author=False)
        await member.kick(reason=sanitize(reason, 400))
        await ctx.reply(f"{member} a été expulsé. Raison : {sanitize(reason)}", mention_author=False)

    @commands.command(name="ban")
    @require_permission_or_owner("ban_members")
    @commands.guild_only()
    async def ban_command(self, ctx: commands.Context, member: discord.Member, *, reason: str = "Aucune raison"):
        if member == ctx.guild.owner or member.top_role >= ctx.guild.me.top_role:
            return await ctx.reply("La hiérarchie des rôles ne me permet pas ce bannissement.", mention_author=False)
        if member.top_role >= ctx.author.top_role and not await self.has_admin_access(ctx):
            return await ctx.reply("La hiérarchie des rôles ne me permet pas ce bannissement.", mention_author=False)
        await member.ban(reason=sanitize(reason, 400))
        await ctx.reply(f"{member} a été banni. Raison : {sanitize(reason)}", mention_author=False)

    @commands.command(name="unban")
    @require_permission_or_owner("ban_members")
    @commands.guild_only()
    async def unban_command(self, ctx: commands.Context, user_id: str):
        if not re.fullmatch(r"\d{17,20}", user_id):
            return await ctx.reply("Indique un identifiant Discord valide.", mention_author=False)
        user = await self.fetch_user(int(user_id))
        await ctx.guild.unban(user, reason=f"Débanni par {ctx.author}")
        await ctx.reply(f"{user} a été débanni.", mention_author=False)

    @commands.command(name="mute")
    @require_permission_or_owner("moderate_members")
    @commands.guild_only()
    async def mute_command(self, ctx: commands.Context, member: discord.Member, minutes: int = 10):
        if not 1 <= minutes <= 40_320:
            return await ctx.reply("Choisis une durée entre 1 minute et 28 jours.", mention_author=False)
        if member == ctx.guild.owner or member.top_role >= ctx.guild.me.top_role:
            return await ctx.reply("La hiérarchie des rôles ne permet pas cette mise en sourdine.", mention_author=False)
        if member.top_role >= ctx.author.top_role and not await self.has_admin_access(ctx):
            return await ctx.reply("La hiérarchie des rôles ne permet pas cette mise en sourdine.", mention_author=False)
        await member.timeout(timedelta(minutes=minutes), reason=f"Mis en sourdine par {ctx.author}")
        await ctx.reply(f"{member.mention} est en sourdine pendant {minutes} minute(s).", mention_author=False)

    @commands.command(name="unmute")
    @require_permission_or_owner("moderate_members")
    @commands.guild_only()
    async def unmute_command(self, ctx: commands.Context, member: discord.Member):
        if member == ctx.guild.owner or member.top_role >= ctx.guild.me.top_role:
            return await ctx.reply("La hiérarchie des rôles ne permet pas cette action.", mention_author=False)
        if member.top_role >= ctx.author.top_role and not await self.has_admin_access(ctx):
            return await ctx.reply("La hiérarchie des rôles ne permet pas cette action.", mention_author=False)
        await member.timeout(None, reason=f"Fin de sourdine par {ctx.author}")
        await ctx.reply(f"La sourdine de {member.mention} est retirée.", mention_author=False)

    @commands.command(name="warn")
    @require_permission_or_owner("manage_messages")
    @commands.guild_only()
    async def warn_command(self, ctx: commands.Context, member: discord.Member, *, reason: str = "Aucune raison"):
        key = rank_key(ctx.guild.id, member.id)
        records = self.data.warns.setdefault(key, [])
        warning_id = max((item["id"] for item in records), default=0) + 1
        records.append({"id": warning_id, "reason": sanitize(reason), "by": str(ctx.author.id),
                        "date": datetime.now(timezone.utc).isoformat()})
        self.data.save("warns")
        await ctx.reply(f"{member.mention} a reçu un avertissement (ID {warning_id}). Raison : {sanitize(reason)}",
                        mention_author=False)

    @commands.command(name="unwarn")
    @require_permission_or_owner("manage_messages")
    @commands.guild_only()
    async def unwarn_command(self, ctx: commands.Context, member: discord.Member, warning_id: int):
        key = rank_key(ctx.guild.id, member.id)
        records = self.data.warns.get(key, [])
        if not any(item["id"] == warning_id for item in records):
            return await ctx.reply("Identifiant d’avertissement introuvable.", mention_author=False)
        self.data.warns[key] = [item for item in records if item["id"] != warning_id]
        self.data.save("warns")
        await ctx.reply(f"Avertissement {warning_id} retiré à {member.mention}.", mention_author=False)

    @commands.command(name="warns")
    @require_permission_or_owner("manage_messages")
    @commands.guild_only()
    async def warns_command(self, ctx: commands.Context, member: discord.Member):
        records = self.data.warns.get(rank_key(ctx.guild.id, member.id), [])
        if not records:
            return await ctx.reply(f"{member.mention} n’a aucun avertissement.", mention_author=False)
        lines = [
            f"**#{row['id']}** — {sanitize(row['reason'], 250)} · par <@{row['by']}> · {row['date'][:10]}"
            for row in records[-20:]
        ]
        await ctx.reply(embed=embed(f"Avertissements de {member}", "\n".join(lines), 0xFFA500),
                        mention_author=False)

    @commands.command(name="clearwarns")
    @commands.check(admin_or_bot_owner)
    @commands.guild_only()
    async def clearwarns_command(self, ctx: commands.Context, member: discord.Member):
        self.data.warns.pop(rank_key(ctx.guild.id, member.id), None)
        self.data.save("warns")
        await ctx.reply(f"Les avertissements de {member.mention} ont été supprimés.", mention_author=False)

    @commands.command(name="lock")
    @require_permission_or_owner("manage_channels")
    @commands.guild_only()
    async def lock_command(self, ctx: commands.Context):
        await ctx.channel.set_permissions(ctx.guild.default_role, send_messages=False)
        await ctx.reply("Salon verrouillé.", mention_author=False)

    @commands.command(name="unlock")
    @require_permission_or_owner("manage_channels")
    @commands.guild_only()
    async def unlock_command(self, ctx: commands.Context):
        await ctx.channel.set_permissions(ctx.guild.default_role, send_messages=True)
        await ctx.reply("Salon déverrouillé.", mention_author=False)

    @commands.command(name="slowmode")
    @require_permission_or_owner("manage_channels")
    @commands.guild_only()
    async def slowmode_command(self, ctx: commands.Context, seconds: int):
        if not 0 <= seconds <= 21_600:
            return await ctx.reply("Choisis un délai entre 0 et 21600 secondes.", mention_author=False)
        await ctx.channel.edit(slowmode_delay=seconds)
        await ctx.reply(f"Mode lent réglé à {seconds} seconde(s).", mention_author=False)

    @commands.command(name="hide")
    @require_permission_or_owner("manage_channels")
    @commands.guild_only()
    async def hide_command(self, ctx: commands.Context):
        await ctx.channel.set_permissions(ctx.guild.default_role, view_channel=False)
        await ctx.reply("Salon masqué pour @everyone.", mention_author=False)

    @commands.command(name="show")
    @require_permission_or_owner("manage_channels")
    @commands.guild_only()
    async def show_command(self, ctx: commands.Context):
        await ctx.channel.set_permissions(ctx.guild.default_role, view_channel=True)
        await ctx.reply("Salon visible pour @everyone.", mention_author=False)

    @commands.command(name="nuke")
    @commands.check(admin_or_bot_owner)
    @commands.guild_only()
    async def nuke_command(self, ctx: commands.Context):
        old = ctx.channel
        new = await old.clone(reason=f"Recréé par {ctx.author}")
        await old.delete(reason="Salon recréé par un administrateur")
        await new.send("Salon recréé.")

    @commands.command(name="serverinfo")
    @commands.guild_only()
    async def serverinfo_command(self, ctx: commands.Context):
        guild = ctx.guild
        card = embed(guild.name, (
            f"Propriétaire : <@{guild.owner_id}>\nMembres : {guild.member_count}\n"
            f"Salons : {len(guild.channels)}\nRôles : {len(guild.roles)}\n"
            f"Créé le : {discord.utils.format_dt(guild.created_at, style='D')}"
        ), 0x3578E5)
        if guild.icon:
            card.set_thumbnail(url=guild.icon.url)
        await ctx.reply(embed=card, mention_author=False)

    @commands.command(name="userinfo")
    @commands.guild_only()
    async def userinfo_command(self, ctx: commands.Context, member: discord.Member | None = None):
        member = member or ctx.author
        roles = [role.mention for role in reversed(member.roles[1:])][:20]
        card = embed(member, (
            f"ID : {member.id}\nBot : {'Oui' if member.bot else 'Non'}\n"
            f"Compte créé : {discord.utils.format_dt(member.created_at, style='D')}\n"
            f"Arrivée : {discord.utils.format_dt(member.joined_at, style='D') if member.joined_at else 'inconnue'}\n"
            f"Rôles : {', '.join(roles) or 'Aucun'}"
        ), member.color.value or 0x00BFFF)
        card.set_thumbnail(url=member.display_avatar.url)
        await ctx.reply(embed=card, mention_author=False)

    @commands.command(name="botinfo")
    async def botinfo_command(self, ctx: commands.Context):
        await ctx.reply(f"Bot en ligne · {len(self.guilds)} serveur(s) · {round(self.latency * 1000)} ms · préfixe `+`.",
                        mention_author=False)

    @commands.command(name="ping")
    async def ping_command(self, ctx: commands.Context):
        await ctx.reply(f"Pong ! `{round(self.latency * 1000)} ms`", mention_author=False)

    @commands.command(name="gstart")
    @commands.check(admin_or_bot_owner)
    @commands.guild_only()
    async def gstart_command(self, ctx: commands.Context, duration: str, winners: int, *, prize: str):
        seconds = parse_duration(duration)
        if seconds is None or not 1 <= winners <= 20 or not prize.strip():
            return await ctx.reply("Usage : `+gstart <durée> <gagnants> <prix>` (ex. `+gstart 2h 1 Nitro`).",
                                   mention_author=False)
        giveaway = await self.create_giveaway(ctx.channel, ctx.author.id, prize, seconds, winners)
        await ctx.reply(f"Giveaway lancé. ID : `{giveaway['id']}`.", mention_author=False)

    @commands.command(name="gend")
    @commands.check(admin_or_bot_owner)
    @commands.guild_only()
    async def gend_command(self, ctx: commands.Context, giveaway_id: str):
        giveaway = self.get_giveaway(ctx.guild.id, giveaway_id)
        if not giveaway or giveaway.get("ended"):
            return await ctx.reply("Giveaway introuvable ou déjà terminé.", mention_author=False)
        await self.finish_giveaway(giveaway)
        await ctx.reply("Giveaway terminé.", mention_author=False)

    @commands.command(name="greroll")
    @commands.check(admin_or_bot_owner)
    @commands.guild_only()
    async def greroll_command(self, ctx: commands.Context, giveaway_id: str):
        giveaway = self.get_giveaway(ctx.guild.id, giveaway_id)
        if not giveaway or not giveaway.get("ended"):
            return await ctx.reply("Giveaway terminé introuvable.", mention_author=False)
        remaining = [uid for uid in giveaway["participants"] if uid not in giveaway["winner_ids"]]
        if not remaining:
            return await ctx.reply("Aucun autre participant disponible.", mention_author=False)
        winner = random.choice(remaining)
        giveaway["winner_ids"].append(winner)
        self.data.save("giveaways")
        await ctx.reply(f"Nouveau tirage : <@{winner}> gagne **{sanitize(giveaway['prize'], 200)}** !",
                        allowed_mentions=discord.AllowedMentions(users=[discord.Object(id=int(winner))]),
                        mention_author=False)

    @commands.command(name="gpanel")
    @commands.check(admin_or_bot_owner)
    @commands.guild_only()
    async def gpanel_command(self, ctx: commands.Context):
        await ctx.reply(embed=embed("Panneau Giveaway", "Clique sur le bouton pour créer un giveaway.", 0xFFD700),
                        view=GiveawayPanelView(self), mention_author=False)

    @commands.command(name="rank")
    @commands.guild_only()
    async def rank_command(self, ctx: commands.Context, member: discord.Member | None = None):
        member = member or ctx.author
        data = self.data.ranks.setdefault(rank_key(ctx.guild.id, member.id), {"xp": 0, "level": 1, "messages": 0})
        required = xp_for_level(data["level"])
        filled = min(20, data["xp"] * 20 // required)
        bar = "█" * filled + "░" * (20 - filled)
        self.data.save("ranks")
        await ctx.reply(embed=embed(
            f"Rang de {member.display_name}",
            f"Niveau **{data['level']}** · {data['xp']}/{required} XP\n"
            f"Messages : {data['messages']}\n`{bar}`",
            0x8A2BE2,
        ), mention_author=False)

    @commands.command(name="leaderboard", aliases=["lb"])
    @commands.guild_only()
    async def leaderboard_command(self, ctx: commands.Context):
        rows = [
            (key.split(":", 1)[1], value)
            for key, value in self.data.ranks.items()
            if key.startswith(f"{ctx.guild.id}:")
        ]
        rows.sort(key=lambda item: (item[1]["level"], item[1]["xp"]), reverse=True)
        lines = []
        for index, (user_id, data) in enumerate(rows[:10], start=1):
            member = ctx.guild.get_member(int(user_id))
            name = sanitize(member.display_name if member else f"Utilisateur {user_id}", 60)
            lines.append(f"**{index}.** {name} — niveau {data['level']} ({data['xp']} XP)")
        await ctx.reply(embed=embed("Classement du serveur", "\n".join(lines) or "Aucun joueur classé.", 0xFFD700),
                        mention_author=False)

    @commands.command(name="setlevel")
    @commands.check(admin_or_bot_owner)
    @commands.guild_only()
    async def setlevel_command(self, ctx: commands.Context, member: discord.Member, level: int):
        if not 1 <= level <= 10_000:
            return await ctx.reply("Le niveau doit être compris entre 1 et 10000.", mention_author=False)
        key = rank_key(ctx.guild.id, member.id)
        data = self.data.ranks.setdefault(key, {"xp": 0, "level": 1, "messages": 0})
        data.update(level=level, xp=0)
        self.data.save("ranks")
        await ctx.reply(f"Niveau de {member.mention} défini à **{level}**.", mention_author=False)

    @commands.command(name="resetrank")
    @commands.check(admin_or_bot_owner)
    @commands.guild_only()
    async def resetrank_command(self, ctx: commands.Context, member: discord.Member):
        self.data.ranks.pop(rank_key(ctx.guild.id, member.id), None)
        self.data.save("ranks")
        await ctx.reply(f"Niveau de {member.mention} réinitialisé.", mention_author=False)

    @commands.command(name="own")
    @commands.check(existing_bot_owner)
    @commands.guild_only()
    async def own_command(self, ctx: commands.Context, member: discord.Member):
        owner_ids = self.data.owners.setdefault("ids", [])
        user_id = str(member.id)
        if user_id in owner_ids or await self.is_bot_owner(member):
            return await ctx.reply(f"{member.mention} est déjà propriétaire du bot.", mention_author=False)
        owner_ids.append(user_id)
        self.data.save("owners")
        await ctx.reply(
            f"{member.mention} peut maintenant utiliser les commandes réservées aux propriétaires du bot.",
            mention_author=False,
        )
