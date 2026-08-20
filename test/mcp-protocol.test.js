import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

test("MCP stdio handshake exposes the expected tools", async (t) => {
  const child = spawn(process.execPath, ["src/mcp/cli.js"], {
    cwd: path.resolve("."),
    env: { ...process.env, CHROME_TAB_GROUPING_DISABLE_BRIDGE: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill("SIGTERM"));
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const responses = lineResponses(child.stdout, () => stderr);
  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
  })}\n`);
  const initialized = await responses.next(5_000);
  assert.equal(initialized.id, 1);
  assert.equal(initialized.result.serverInfo.name, "chrome-tab-grouping");

  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
  const tools = await responses.next(5_000);
  assert.equal(tools.id, 2);
  assert.deepEqual(
    tools.result.tools.map((tool) => tool.name).sort(),
    [
      "apply_tab_grouping",
      "list_chrome_profiles",
      "list_chrome_tabs",
      "preview_tab_grouping",
      "undo_last_tab_grouping",
    ],
  );
});

function lineResponses(stream, diagnostics) {
  let buffer = "";
  const queue = [];
  const waiters = [];
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const boundary = buffer.indexOf("\n");
      const line = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 1);
      if (!line) continue;
      const value = JSON.parse(line);
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(value);
      else queue.push(value);
    }
  });
  return {
    next(timeoutMs) {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for MCP response. ${diagnostics()}`)), timeoutMs);
        waiters.push({
          resolve(value) {
            clearTimeout(timer);
            resolve(value);
          },
        });
      });
    },
  };
}
