import assert from "node:assert/strict";
import test from "node:test";
import { VoiceTracker } from "../src/voice-tracker.js";

test("voice time is counted between joining and leaving a voice channel", () => {
  const savedTime = [];
  const database = {
    addVoiceTime: (...args) => savedTime.push(args),
  };
  const tracker = new VoiceTracker(database);
  const guild = { id: "guild-test", afkChannelId: "afk" };
  const member = { id: "member-test", user: { bot: false } };
  const state = (channelId) => ({ guild, member, channelId });

  tracker.handleStateChange(state(null), state("voice"), 100);
  assert.equal(tracker.activeDuration(guild.id, member.id, 600), 500);

  tracker.handleStateChange(state("voice"), state(null), 1_100);
  assert.deepEqual(savedTime, [["guild-test", "member-test", 1_000]]);
  assert.equal(tracker.activeDuration(guild.id, member.id, 1_100), 0);
});

test("the server AFK channel is not counted as voice activity", () => {
  const savedTime = [];
  const tracker = new VoiceTracker({
    addVoiceTime: (...args) => savedTime.push(args),
  });
  const guild = { id: "guild-test", afkChannelId: "afk" };
  const member = { id: "member-test", user: { bot: false } };
  const state = (channelId) => ({ guild, member, channelId });

  tracker.handleStateChange(state(null), state("afk"), 100);
  assert.equal(tracker.activeDuration(guild.id, member.id, 5_000), 0);
  assert.deepEqual(savedTime, []);
});
