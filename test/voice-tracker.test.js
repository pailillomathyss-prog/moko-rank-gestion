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

test("pausing a test excludes vocal time until the test ends", () => {
  const savedTime = [];
  const tracker = new VoiceTracker({
    addVoiceTime: (...args) => savedTime.push(args),
  });
  const guild = {
    id: "guild-test",
    afkChannelId: "afk",
    voiceStates: { cache: new Map() },
  };
  const member = { id: "member-test", user: { bot: false } };
  const activeState = { guild, member, channelId: "voice" };
  const inactiveState = { guild, member, channelId: null };

  guild.voiceStates.cache.set(member.id, activeState);
  tracker.handleStateChange(inactiveState, activeState, 100);
  tracker.pauseUser(guild.id, member.id, 600);
  assert.equal(tracker.activeDuration(guild.id, member.id, 700), 0);

  tracker.resumeUser(guild, member, 700);
  assert.equal(tracker.activeDuration(guild.id, member.id, 1_000), 300);
  tracker.handleStateChange(activeState, inactiveState, 1_000);
  assert.deepEqual(savedTime, [
    ["guild-test", "member-test", 500],
    ["guild-test", "member-test", 300],
  ]);
});
