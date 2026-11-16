import unittest
from unittest.mock import AsyncMock

import discord
from discord import app_commands

from quiz.discord_bot import QuizClient


class CommandResetTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = QuizClient(":memory:")
        await self.client.store.open()

    async def asyncTearDown(self):
        await self.client.close()

    async def test_bot_starts_without_registered_commands(self):
        self.assertEqual(self.client.tree.get_commands(), [])

    async def test_global_sync_removes_all_remote_commands(self):
        submitted = []

        async def sync():
            submitted.extend(self.client.tree.get_commands())
            return []

        self.client.tree.sync = AsyncMock(side_effect=sync)
        await self.client.clear_global_commands()
        self.assertEqual(submitted, [])
        self.assertTrue(self.client.global_commands_cleared)

    async def test_guild_sync_removes_legacy_commands(self):
        guild = discord.Object(id=123)

        async def old_command(interaction):
            pass

        self.client.tree.add_command(
            app_commands.Command(name="ancienne", description="Legacy", callback=old_command),
            guild=guild,
        )
        submitted = []

        async def sync(*, guild):
            submitted.extend(self.client.tree.get_commands(guild=guild))
            return []

        self.client.tree.sync = AsyncMock(side_effect=sync)
        await self.client.sync_guild(guild)
        self.assertEqual(submitted, [])
        self.assertIn(guild.id, self.client.synced)

    async def test_failed_global_sync_is_retried_on_next_ready(self):
        self.client.tree.sync = AsyncMock(side_effect=RuntimeError("Discord indisponible"))
        await self.client.clear_global_commands()
        self.assertFalse(self.client.global_commands_cleared)


if __name__ == "__main__":
    unittest.main()
