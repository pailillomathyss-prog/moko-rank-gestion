import assert from "node:assert/strict";
import test from "node:test";
import { createLogPanel } from "../src/log-panel.js";

test("log panel shows the selected channel and provides a text-channel picker", () => {
  const guild = {
    channels: {
      cache: new Map([["rank-logs", { id: "rank-logs" }]]),
    },
  };
  const panel = createLogPanel(guild, { rankLogChannelId: "rank-logs" });
  const embed = panel.embeds[0].toJSON();
  const menu = panel.components[0].toJSON().components[0];

  assert.equal(embed.fields[0].value, "<#rank-logs>");
  assert.equal(menu.custom_id, "moko:logs:channel");
  assert.deepEqual(menu.channel_types, [0]);
});
