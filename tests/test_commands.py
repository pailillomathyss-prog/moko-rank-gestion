import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

import discord
from discord import app_commands

from quiz.discord_bot import QuizClient, DiscordTransport
from quiz.questions import Question


async def empty_history(**kwargs):
    if False:
        yield None


class CommandTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = QuizClient(":memory:")
        await self.client.store.open()
        self.client.game = SimpleNamespace(configure=AsyncMock(), transport=SimpleNamespace(channel=AsyncMock()))

    async def asyncTearDown(self):
        await self.client.close()

    def interaction(self, admin=False):
        return SimpleNamespace(
            guild_id=1, guild=SimpleNamespace(get_member=lambda _: None),
            permissions=discord.Permissions(administrator=admin),
            user=SimpleNamespace(id=20, display_name="Joueur"),
            response=SimpleNamespace(defer=AsyncMock(), is_done=lambda: False, send_message=AsyncMock()),
            followup=SimpleNamespace(send=AsyncMock()),
        )

    async def test_command_tree_matches_requested_interface(self):
        self.assertEqual({c.name for c in self.client.tree.get_commands()}, {"config", "points", "classement", "monrang"})
        config = self.client.tree.get_command("config")
        self.assertEqual({c.name for c in config.commands}, {"salon", "frequence", "temps", "activer", "desactiver", "statut"})
        for command in self.client.tree.get_commands():
            command.to_dict(self.client.tree)

    async def test_global_legacy_commands_are_cleared_without_losing_new_definitions(self):
        payloads = []
        async def sync(**kwargs):
            payloads.append([c.name for c in self.client.tree.get_commands()])
            return []
        self.client.tree.sync = AsyncMock(side_effect=sync)
        await self.client.clear_global_commands()
        self.assertEqual(payloads, [[]])
        self.assertTrue(self.client.global_commands_cleared)
        self.assertEqual({c.name for c in self.client.tree.get_commands()}, {"config", "points", "classement", "monrang"})

    async def test_failed_global_cleanup_restores_local_commands_for_retry(self):
        self.client.tree.sync = AsyncMock(side_effect=RuntimeError("Discord unavailable"))
        await self.client.clear_global_commands()
        self.assertFalse(self.client.global_commands_cleared)
        self.assertEqual({c.name for c in self.client.tree.get_commands()}, {"config", "points", "classement", "monrang"})

    async def test_guild_sync_replaces_legacy_commands_with_only_new_game(self):
        guild = discord.Object(id=123)
        async def old_callback(interaction):
            pass
        self.client.tree.add_command(app_commands.Command(name="activite", description="Ancienne commande", callback=old_callback), guild=guild)
        submitted = []
        async def sync(**kwargs):
            commands = self.client.tree.get_commands(guild=kwargs["guild"])
            submitted.extend(c.name for c in commands)
            return commands
        self.client.tree.sync = AsyncMock(side_effect=sync)
        await self.client.sync_guild(guild)
        self.assertEqual(set(submitted), {"config", "points", "classement", "monrang"})
        self.assertIn(guild.id, self.client.synced)

    async def test_every_config_command_checks_admin_at_execution(self):
        for command in self.client.tree.get_command("config").commands:
            self.assertTrue(command.checks)
            for check in command.checks:
                with self.assertRaises(app_commands.MissingPermissions):
                    check(self.interaction())
                self.assertTrue(check(self.interaction(admin=True)))

    async def test_points_self_and_other_member(self):
        command = self.client.tree.get_command("points")
        i = self.interaction()
        await command.callback(i)
        self.assertIn("0 points", i.followup.send.call_args.kwargs["embed"].description)
        await self.client.store.db.execute("INSERT INTO scores VALUES (1,30,'Autre',9)")
        await self.client.store.db.commit()
        await command.callback(i, SimpleNamespace(id=30, display_name="Autre"))
        self.assertIn("9 points", i.followup.send.call_args.kwargs["embed"].description)

    async def test_top_ten_rank_and_empty_state(self):
        i = self.interaction()
        await self.client.tree.get_command("classement").callback(i)
        self.assertIn("Aucun point", i.followup.send.call_args.kwargs["embed"].description)
        await self.client.store.db.executemany("INSERT INTO scores VALUES (1,?,?,?)",
            [(20 + x, f"Joueur{x}", 20 - x) for x in range(12)])
        await self.client.store.db.commit()
        await self.client.tree.get_command("classement").callback(i)
        self.assertEqual(len(i.followup.send.call_args.kwargs["embed"].description.splitlines()), 10)
        await self.client.tree.get_command("monrang").callback(i)
        self.assertIn("n°1", i.followup.send.call_args.kwargs["embed"].description)

    async def test_configuration_callbacks_forward_correct_values(self):
        config = self.client.tree.get_command("config")
        i = self.interaction(admin=True)
        await config.get_command("frequence").callback(i, 30)
        self.client.game.configure.assert_awaited_with(1, frequency=30)
        await config.get_command("temps").callback(i, 45)
        self.client.game.configure.assert_awaited_with(1, duration=45)
        await config.get_command("desactiver").callback(i)
        self.client.game.configure.assert_awaited_with(1, enabled=0)
        await config.get_command("statut").callback(i)
        self.assertEqual(i.followup.send.call_args.kwargs["embed"].title, "⚙️ Jeu de devinettes")

    async def test_activate_requires_channel(self):
        i = self.interaction(admin=True)
        await self.client.tree.get_command("config").get_command("activer").callback(i)
        self.client.game.configure.assert_not_awaited()
        self.assertIn("/config salon", i.followup.send.call_args.args[0])

    async def test_select_channel_and_activate_with_permissions(self):
        i = self.interaction(admin=True)
        i.guild.id = 1
        i.guild.me = object()
        permissions = discord.Permissions(view_channel=True, send_messages=True, embed_links=True,
                                          attach_files=True, read_message_history=True)
        channel = SimpleNamespace(id=10, guild=i.guild, mention="<#10>", permissions_for=lambda _: permissions)
        config = self.client.tree.get_command("config")
        await config.get_command("salon").callback(i, channel)
        self.client.game.configure.assert_awaited_with(1, channel=10)
        await self.client.store.configure(1, channel=10)
        self.client.game.transport.channel.return_value = channel
        await config.get_command("activer").callback(i)
        self.client.game.configure.assert_awaited_with(1, enabled=1)

    async def test_question_attachment_is_neutral_and_timeout_reveals_answer(self):
        sent = SimpleNamespace(id=99, created_at=SimpleNamespace(timestamp=lambda: 1000))
        partial = SimpleNamespace(edit=AsyncMock())
        channel = SimpleNamespace(send=AsyncMock(return_value=sent), get_partial_message=lambda _: partial)
        channel.history = empty_history
        transport = DiscordTransport(self.client)
        transport.channel = AsyncMock(return_value=channel)
        question = Question("q", "Calcul", "12", [], expression="6 + 6")
        row = dict(id=1, channel=10, duration=20)
        self.assertEqual(await transport.question(row, question, question.image()), (99, 1000))
        payload = channel.send.call_args.kwargs
        self.assertEqual(payload["file"].filename, "devinette.png")
        self.assertEqual(set(payload), {"file"})
        await transport.result({**row, "message_id": 99, "status": "expired"}, question)
        self.assertIn("12", channel.send.call_args.args[0])
        partial.edit.assert_not_awaited()

    async def test_victory_is_a_new_message_with_winner_time_point_and_total(self):
        partial = SimpleNamespace(edit=AsyncMock())
        transport = DiscordTransport(self.client)
        channel = SimpleNamespace(send=AsyncMock(), history=empty_history, get_partial_message=lambda _: partial)
        transport.channel = AsyncMock(return_value=channel)
        result = dict(channel=10, message_id=999, id=1, status="won", winner_name="Joueur",
                      winner=20, elapsed=7.42, total=15)
        await transport.result(result, Question("q", "Animal", "Éléphant", []))
        self.assertEqual(channel.send.call_args.args[0], "Bravo <@20> ! +1 en 7,42 secondes. Total : 15 points.")
        self.assertNotIn("embed", channel.send.call_args.kwargs)
        partial.edit.assert_not_awaited()

    async def test_existing_result_reply_is_not_sent_twice(self):
        client = SimpleNamespace(user=SimpleNamespace(id=42))
        async def history(**kwargs):
            yield SimpleNamespace(author=SimpleNamespace(id=42), reference=SimpleNamespace(message_id=999))
        channel = SimpleNamespace(history=history, send=AsyncMock())
        transport = DiscordTransport(client)
        transport.channel = AsyncMock(return_value=channel)
        await transport.result(dict(channel=10, message_id=999, id=1, status="won",
                                    winner=20, elapsed=1, total=1), Question("q", "Animal", "Chat", []))
        channel.send.assert_not_awaited()
