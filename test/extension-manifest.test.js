import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("extension exposes the reconnect popup", async () => {
  const manifest = JSON.parse(await fs.readFile("extension/manifest.json", "utf8"));
  assert.equal(manifest.action.default_popup, "popup.html");
  await Promise.all([
    fs.access(`extension/${manifest.action.default_popup}`),
    fs.access("extension/popup.js"),
  ]);
});
