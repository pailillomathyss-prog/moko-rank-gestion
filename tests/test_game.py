import asyncio
import io
import random
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from quiz.engine import Engine
from quiz.questions import Question, QuestionBank
from quiz.storage import Storage


class Clock:
    def __init__(self):
        self.now = 1000.0
    def __call__(self):
        return self.now


class Bank:
    def choose(self, recent):
        return Question("math:test", "Calcul", "12", [], expression="6 + 6")


class Transport:
    def __init__(self, clock):
        self.clock = clock
        self.sent = []
        self.results = {}
        self.fail_question = False
        self.fail_result = False
    async def question(self, round_, question, png):
        if self.fail_question:
            raise OSError("Fake transport failure")
        with Image.open(io.BytesIO(png)) as image:
            self_size = image.size
        assert self_size == (800, 560)
        self.sent.append(round_["id"])
        return 9000 + round_["id"], self.clock()
    async def result(self, round_, question):
        if self.fail_result:
            raise OSError("Fake result failure")
        self.results[round_["id"]] = round_


class GameTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / "game.sqlite")
        self.db = await Storage(self.path).open()
        await self.db.configure(1, channel=10, enabled=1)
        self.clock = Clock()
        self.transport = Transport(self.clock)
        self.game = Engine(self.db, Bank(), self.transport, self.clock)
        self.seq = 0

    async def asyncTearDown(self):
        await self.db.close()
        self.temp.cleanup()

    async def message(self, text="discussion", **overrides):
        self.seq += 1
        data = dict(guild=1, channel=10, message_id=self.seq, user=20, name="Joueur",
                    text=text, created=self.clock())
        data.update(overrides)
        await self.game.message(**data)

    async def trigger(self):
        for _ in range(15):
            await self.message()

    async def test_fifteenth_message_triggers_one_image_with_twenty_seconds(self):
        for _ in range(14):
            await self.message()
        self.assertEqual(self.transport.sent, [])
        self.assertEqual((await self.db.settings(1))["counter"], 14)
        await self.message()
        current = await self.db.live(1)
        self.assertEqual(len(self.transport.sent), 1)
        self.assertEqual(current["deadline"] - current["started"], 20)
        self.assertEqual((await self.db.settings(1))["counter"], 0)

    async def test_bots_commands_other_channels_and_duplicates_do_not_increment(self):
        await self.message(bot=True)
        await self.message(command=True)
        await self.message(channel=99)
        await self.message(message_id=999)
        await self.message(message_id=999)
        self.assertEqual((await self.db.settings(1))["counter"], 1)

    async def test_counter_settings_and_points_survive_reopen(self):
        for _ in range(14):
            await self.message()
        await self.db.close()
        self.db = await Storage(self.path).open()
        self.game = Engine(self.db, Bank(), self.transport, self.clock)
        self.assertEqual((await self.db.settings(1))["counter"], 14)
        await self.message()
        self.clock.now += 7.42
        await self.message("12")
        await self.db.close()
        self.db = await Storage(self.path).open()
        self.assertEqual(await self.db.points(1, 20), 1)
        self.assertEqual((await self.db.settings(1))["channel"], 10)
        self.assertEqual((await self.db.settings(1))["counter"], 1)
        self.assertAlmostEqual(next(iter(self.transport.results.values()))["elapsed"], 7.42)

    async def test_simultaneous_answers_award_exactly_one_point(self):
        await self.trigger()
        self.clock.now += 1
        await asyncio.gather(*(self.message("12", user=100 + index, name=f"Joueur {index}") for index in range(8)))
        leaderboard = await self.db.leaderboard(1)
        self.assertEqual(sum(row["points"] for row in leaderboard), 1)
        self.assertEqual(len(leaderboard), 1)

    async def test_sql_transaction_also_prevents_two_winners_without_engine_lock(self):
        await self.trigger()
        current = await self.db.live(1)
        results = await asyncio.gather(*(
            self.db.finish(current["id"], user=user, name="Joueur", submitted=1002)
            for user in (20, 21)
        ))
        self.assertEqual(sum(r is not None for r in results), 1)

    async def test_same_player_can_only_win_once_per_round(self):
        await self.trigger()
        await self.message("12")
        await self.message("12")
        self.assertEqual(await self.db.points(1, 20), 1)
        self.assertEqual(len(self.transport.results), 1)

    async def test_timeout_reveals_answer_and_rejects_late_answer(self):
        await self.trigger()
        self.clock.now += 20.001
        await self.message("12")
        self.assertEqual(await self.db.points(1, 20), 0)
        result = next(iter(self.transport.results.values()))
        self.assertEqual(result["status"], "expired")
        self.assertEqual(Question.deserialize(result["question"]).answer, "12")

    async def test_timer_expires_without_any_message(self):
        await self.trigger()
        self.clock.now += 20
        await self.game.tick()
        self.assertIsNone(await self.db.live(1))
        self.assertEqual(next(iter(self.transport.results.values()))["status"], "expired")

    async def test_messages_during_round_accumulate_without_overlapping_rounds(self):
        await self.trigger()
        for _ in range(17):
            await self.message("wrong")
        self.assertEqual(len(self.transport.sent), 1)
        self.assertEqual((await self.db.settings(1))["counter"], 17)
        self.clock.now += 20
        await self.game.tick()
        self.assertEqual(len(self.transport.sent), 2)
        self.assertEqual((await self.db.settings(1))["counter"], 2)

    async def test_failed_image_delivery_does_not_lose_counter(self):
        self.transport.fail_question = True
        await self.trigger()
        self.assertEqual((await self.db.settings(1))["counter"], 15)
        self.assertIsNone(await self.db.live(1))
        self.transport.fail_question = False
        self.clock.now += 30
        await self.game.tick()
        self.assertEqual(len(self.transport.sent), 1)
        self.assertEqual((await self.db.settings(1))["counter"], 0)

    async def test_failed_result_delivery_keeps_point_and_retries_without_double_credit(self):
        await self.trigger()
        self.transport.fail_result = True
        await self.message("12")
        self.assertEqual(await self.db.points(1, 20), 1)
        self.assertEqual(len(await self.db.pending()), 1)
        self.transport.fail_result = False
        await self.game.tick()
        await self.game.tick()
        self.assertEqual(await self.db.points(1, 20), 1)
        self.assertEqual(len(await self.db.pending()), 0)
        self.assertEqual(len(self.transport.results), 1)

    async def test_restart_resumes_live_round_with_original_deadline(self):
        await self.trigger()
        self.clock.now += 10
        await self.db.close()
        self.db = await Storage(self.path).open()
        self.game = Engine(self.db, Bank(), self.transport, self.clock)
        await self.game.recover()
        self.assertEqual((await self.db.live(1))["deadline"], 1020)
        self.assertEqual(len(self.transport.sent), 1)
        self.clock.now += 3
        await self.message("12")
        self.assertEqual(await self.db.points(1, 20), 1)

    async def test_restart_after_deadline_closes_round_without_resetting_timer(self):
        await self.trigger()
        self.clock.now += 200
        await self.game.recover()
        self.assertIsNone(await self.db.live(1))
        self.assertEqual(len(self.transport.sent), 1)
        self.assertEqual(next(iter(self.transport.results.values()))["status"], "expired")

    async def test_recovery_of_interrupted_send_preserves_message_budget(self):
        for index in range(15):
            await self.db.count_message(1, 1000 + index)
        unfinished = await self.db.begin(1, Bank().choose([]))
        self.assertEqual(unfinished["status"], "sending")
        self.assertEqual((await self.db.settings(1))["counter"], 15)
        await self.game.recover()
        current = await self.db.live(1)
        self.assertEqual(current["status"], "active")
        self.assertNotEqual(current["id"], unfinished["id"])
        self.assertEqual((await self.db.settings(1))["counter"], 0)

    async def test_disable_cancels_game_preserves_counter_and_points(self):
        await self.trigger()
        await self.message("wrong")
        await self.game.configure(1, enabled=0)
        await self.message("12")
        self.assertIsNone(await self.db.live(1))
        self.assertEqual(await self.db.points(1, 20), 0)
        self.assertEqual((await self.db.settings(1))["counter"], 1)

    async def test_channel_change_cancels_old_question(self):
        await self.trigger()
        await self.game.configure(1, channel=11)
        await self.message("12", channel=10)
        self.assertEqual(await self.db.points(1, 20), 0)
        self.assertIsNone(await self.db.live(1))
        self.assertEqual((await self.db.settings(1))["channel"], 11)

    async def test_custom_frequency_and_time(self):
        await self.game.configure(1, frequency=3, duration=40)
        for _ in range(3):
            await self.message()
        current = await self.db.live(1)
        self.assertEqual(current["duration"], 40)
        self.assertEqual(current["deadline"], 1040)

    async def test_scores_and_leaderboard_are_per_guild_with_ties(self):
        await self.db.db.executemany("INSERT INTO scores VALUES (?,?,?,?)",
            [(1, 1, "A", 5), (1, 2, "B", 5), (1, 3, "C", 2), (2, 4, "D", 100)])
        await self.db.db.commit()
        rows = await self.db.leaderboard(1)
        self.assertEqual([r["position"] for r in rows], [1, 1, 3])
        self.assertEqual((await self.db.rank(1, 3))["position"], 3)
        self.assertIsNone(await self.db.rank(1, 4))
        self.assertEqual(await self.db.points(1, 999), 0)


class QuestionTests(unittest.TestCase):
    def test_aliases_accents_case_articles_and_small_typos(self):
        q = Question("elephant", "Animal", "Éléphant", [])
        for value in ["ÉLÉPHANT", "elephant", "un éléphant", "elephants", "elephent"]:
            self.assertTrue(q.matches(value), value)
        for value in ["chien", "elephant ou chat", "", "a" * 101]:
            self.assertFalse(q.matches(value), value)
        self.assertFalse(Question("lion", "Animal", "Lion", []).matches("pion"))

    def test_math_is_exact_and_never_evaluates_expressions(self):
        q = Bank().choose([])
        for value in ["12", "12.0", "12,0", "+12"]:
            self.assertTrue(q.matches(value))
        for value in ["13", "6+6", "__import__('os')", "NaN", "12 13"]:
            self.assertFalse(q.matches(value))

    def test_all_images_valid_unique_and_questions_avoid_recent_duplicates(self):
        bank = QuestionBank(random.Random(4))
        self.assertEqual(len(bank.questions), 30)
        recent = []
        for _ in range(60):
            q = bank.choose(recent)
            self.assertNotIn(q.key, recent)
            with Image.open(io.BytesIO(q.image())) as image:
                self.assertEqual(image.size, (800, 560))
            recent = (recent + [q.key])[-10:]
