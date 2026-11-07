import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  bridgeControlEndpointFor,
  bridgeEndpointFor,
  undoStatePathFor,
} from "../src/bridge/paths.js";
import { UndoStore } from "../src/core/state-store.js";

test("uses a Unix socket on macOS", () => {
  assert.equal(
    bridgeEndpointFor({ platform: "darwin", tempDir: "/tmp/example", identity: "501" }),
    "/tmp/example/chatgpt-chrome-tab-grouping-v2-501.sock",
  );
  assert.equal(
    bridgeControlEndpointFor({ platform: "darwin", tempDir: "/tmp/example", identity: "501" }),
    "/tmp/example/chatgpt-chrome-tab-grouping-control-v2-501.sock",
  );
});

test("uses a named pipe with a sanitized identity on Windows", () => {
  assert.equal(
    bridgeEndpointFor({ platform: "win32", identity: "DOMAIN\\Jake Martin" }),
    "\\\\.\\pipe\\chatgpt-chrome-tab-grouping-v2-DOMAIN-Jake-Martin",
  );
  assert.equal(
    bridgeControlEndpointFor({ platform: "win32", identity: "DOMAIN\\Jake Martin" }),
    "\\\\.\\pipe\\chatgpt-chrome-tab-grouping-control-v2-DOMAIN-Jake-Martin",
  );
});

test("keeps undo state in the platform temporary directory", () => {
  assert.equal(
    undoStatePathFor({ platform: "win32", tempDir: "C:\\Temp", identity: "Jake Martin" }),
    "C:\\Temp\\chatgpt-chrome-tab-grouping-undo-Jake-Martin.json",
  );
});

test("undo storage can skip POSIX permission operations", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chrome-tab-windows-state-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new UndoStore(path.join(directory, "undo.json"), { supportsPosixPermissions: false });
  await store.save({ platform: "windows" });
  assert.deepEqual(await store.load(), { platform: "windows" });
});
