import assert from "node:assert/strict";
import test from "node:test";
import {
  highestConfiguredRank,
  highestEligibleRank,
  RANKS,
} from "../src/ranks.js";

test("each rank requires both its message and voice quota", () => {
  for (const rank of RANKS) {
    const voiceMs = rank.voiceHours * 60 * 60 * 1000;
    assert.equal(
      highestEligibleRank({ messages: rank.messages, voiceMs })?.level,
      rank.level
    );
    assert.notEqual(
      highestEligibleRank({ messages: rank.messages - 1, voiceMs })?.level,
      rank.level
    );
    assert.notEqual(
      highestEligibleRank({
        messages: rank.messages,
        voiceMs: voiceMs - 1,
      })?.level,
      rank.level
    );
  }
});

test("the highest configured qualifying rank is selected", () => {
  const stats = { messages: 9_000, voiceMs: 101 * 60 * 60 * 1000 };
  const roles = ["role-1", "role-2", null, "role-4", "role-5"];
  assert.equal(highestConfiguredRank(stats, roles)?.level, 5);
  assert.equal(
    highestConfiguredRank(stats, [null, null, null, "role-4", null])?.level,
    4
  );
  assert.equal(highestConfiguredRank({ messages: 0, voiceMs: 0 }, roles), null);
});
