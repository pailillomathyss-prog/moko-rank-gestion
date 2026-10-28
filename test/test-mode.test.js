import assert from "node:assert/strict";
import test from "node:test";
import { nextTestLevel } from "../src/test-mode.js";

test("each test message advances exactly one rank", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((level) => nextTestLevel(level)),
    [1, 2, 3, 4, 5]
  );
  assert.equal(nextTestLevel(5), null);
  assert.equal(nextTestLevel(-1), null);
});
