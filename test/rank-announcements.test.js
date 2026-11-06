import assert from "node:assert/strict";
import test from "node:test";
import { createRankAnnouncement } from "../src/rank-announcements.js";
import { RANKS } from "../src/ranks.js";

test("rank announcement includes the member avatar and test mode label", () => {
  const member = {
    id: "member-test",
    displayName: "Moko",
    user: {
      displayAvatarURL: () => "https://cdn.example/avatar.png",
    },
    toString: () => "<@member-test>",
  };
  const payload = createRankAnnouncement(
    member,
    RANKS[0],
    { id: "rank-one" },
    { isTest: true }
  );
  const embed = payload.embeds[0].toJSON();

  assert.equal(payload.allowedMentions.users[0], member.id);
  assert.equal(embed.thumbnail.url, "https://cdn.example/avatar.png");
  assert.equal(embed.author.icon_url, "https://cdn.example/avatar.png");
  assert.match(embed.title, /Test de rang/);
  assert.match(payload.content, /tester le palier 1/);
});
