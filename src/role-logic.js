import {
  highestConfiguredRank,
  highestEligibleRank,
} from "./ranks.js";

export { highestConfiguredRank, highestEligibleRank };

export function getProgress(stats, rank) {
  return {
    messages: Math.min(1, stats.messages / rank.messages),
    voice: Math.min(
      1,
      stats.voiceMs / (rank.voiceHours * 60 * 60 * 1000)
    ),
  };
}
