import { RANKS } from "./ranks.js";

export function nextTestLevel(currentLevel) {
  if (
    !Number.isInteger(currentLevel) ||
    currentLevel < 0 ||
    currentLevel >= RANKS.length
  ) {
    return null;
  }
  return currentLevel + 1;
}
