import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import discord

from management_bot import (
    DATA_FILES,
    HELP_PAGES,
    BotData,
    ManagementBot,
    existing_bot_owner,
    parse_duration,
    rank_key,
    require_permission_or_owner,
    xp_for_level,
)
from discord.ext import commands


class ManagementBotTests(unittest.IsolatedAsyncioTestCase):
    async def test_administrator_and_server_owner_are_recognized(self):
        bot = ManagementBot(Path(tempfile.gettempdir()) / "management-bot-no-write")
        bot.is_bot_owner = AsyncMock(return_value=False)
        guild = SimpleNamespace(owner_id=99)
        for user_id, admin in [(1, True), (99, False)]:
            ctx = SimpleNamespace(
                guild=guild,
                author=SimpleNamespace(
                    id=user_id,
                    guild_permissions=discord.Permissions(administrator=admin),
                ),
            )
            self.assertTrue(await bot.has_admin_access(ctx))

    async def test_configured_bot_owner_can_use_admin_commands(self):
        bot = ManagementBot(Path(tempfile.gettempdir()) / "management-bot-no-write")
        bot.is_bot_owner = AsyncMock(return_value=True)
        ctx = SimpleNamespace(
            guild=SimpleNamespace(owner_id=99),
            author=SimpleNamespace(id=10, guild_permissions=discord.Permissions.none()),
        )
        self.assertTrue(await bot.has_admin_access(ctx))

    async def test_regular_member_does_not_pass_admin_check(self):
        bot = ManagementBot(Path(tempfile.gettempdir()) / "management-bot-no-write")
        bot.is_bot_owner = AsyncMock(return_value=False)
        ctx = SimpleNamespace(
            guild=SimpleNamespace(owner_id=99),
            author=SimpleNamespace(id=10, guild_permissions=discord.Permissions.none()),
        )
        self.assertFalse(await bot.has_admin_access(ctx))

    async def test_manage_messages_permission_and_bot_owner_access(self):
        bot = ManagementBot(Path(tempfile.gettempdir()) / "management-bot-no-write")
        bot.is_bot_owner = AsyncMock(return_value=False)
        ctx = SimpleNamespace(
            guild=SimpleNamespace(owner_id=99),
            author=SimpleNamespace(
                id=10,
                guild_permissions=discord.Permissions(manage_messages=True),
            ),
            bot=bot,
        )
        check = require_permission_or_owner("manage_messages").predicate
        self.assertTrue(await check(ctx))
        ctx.author.guild_permissions = discord.Permissions.none()
        with self.assertRaises(commands.MissingPermissions):
            await check(ctx)
        bot.is_bot_owner = AsyncMock(return_value=True)
        self.assertTrue(await check(ctx))

    async def test_only_a_bot_owner_can_grant_another_owner(self):
        bot = ManagementBot(Path(tempfile.gettempdir()) / "management-bot-no-write")
        bot.is_bot_owner = AsyncMock(return_value=False)
        ctx = SimpleNamespace(bot=bot, author=SimpleNamespace(id=10))
        with self.assertRaises(commands.NotOwner):
            await existing_bot_owner(ctx)
        bot.is_bot_owner = AsyncMock(return_value=True)
        self.assertTrue(await existing_bot_owner(ctx))

    async def test_unexpected_command_errors_are_logged_with_a_reference(self):
        bot = ManagementBot(Path(tempfile.gettempdir()) / "management-bot-no-write")
        ctx = SimpleNamespace(
            command=SimpleNamespace(qualified_name="kick"),
            guild=SimpleNamespace(id=42),
            channel=SimpleNamespace(id=43),
            author=SimpleNamespace(id=44),
            reply=AsyncMock(),
        )
        try:
            raise RuntimeError("test failure detail")
        except RuntimeError as original:
            error = commands.CommandInvokeError(original)

        with self.assertLogs("management_bot", level="ERROR") as captured:
            await bot.on_command_error(ctx, error)

        reply = ctx.reply.await_args.args[0]
        self.assertIn("erreur interne", reply)
        self.assertIn("Référence", reply)
        self.assertNotIn("Vérifie mes permissions", reply)
        self.assertIn("commande=kick", captured.output[0])
        self.assertIn("test failure detail", captured.output[0])
        self.assertEqual(ctx.reply.await_args.kwargs["mention_author"], False)

    async def test_commands_and_permissions_are_registered(self):
        bot = ManagementBot(Path(tempfile.gettempdir()) / "management-bot-no-write")
        names = {command.name for command in bot.commands}
        required = {
            "help", "panel", "clear", "kick", "ban", "unban", "mute", "unmute",
            "warn", "unwarn", "warns", "clearwarns", "lock", "unlock", "slowmode",
            "hide", "show", "nuke", "serverinfo", "userinfo", "botinfo", "ping",
            "gstart", "gend", "greroll", "gpanel", "rank", "leaderboard",
            "setlevel", "resetrank", "autorole", "autoroleoff", "addrole",
            "removerole", "own",
        }
        self.assertEqual(names, required)
        for name in ("panel", "gpanel", "gstart", "setlevel", "own"):
            self.assertTrue(bot.get_command(name).checks, f"{name} doit être protégé")
        self.assertIn("owner", HELP_PAGES)

    def test_duration_and_xp_rules(self):
        self.assertEqual(parse_duration("10m"), 600)
        self.assertEqual(parse_duration("2h"), 7200)
        self.assertEqual(parse_duration("1d"), 86400)
        self.assertIsNone(parse_duration("1 week"))
        self.assertIsNone(parse_duration("999d"))
        self.assertEqual(rank_key(12, 34), "12:34")
        self.assertEqual(xp_for_level(1), 155)
        self.assertGreater(xp_for_level(5), xp_for_level(2))

    def test_reset_erases_old_data_once_then_preserves_new_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for filename in (*DATA_FILES.values(), "quiz.sqlite", "quiz.sqlite-wal", "quiz.sqlite-shm"):
                (directory / filename).write_text('{"old": true}', encoding="utf-8")
            (directory / "unrelated.txt").write_text("keep", encoding="utf-8")

            first = BotData(directory)
            for name in DATA_FILES:
                self.assertEqual(getattr(first, name), {})
            self.assertFalse((directory / "quiz.sqlite").exists())

            first.ranks["new"] = {"xp": 10}
            first.save("ranks")
            second = BotData(directory)
            self.assertEqual(second.ranks, {"new": {"xp": 10}})
            self.assertEqual((directory / "unrelated.txt").read_text(encoding="utf-8"), "keep")


if __name__ == "__main__":
    unittest.main()
