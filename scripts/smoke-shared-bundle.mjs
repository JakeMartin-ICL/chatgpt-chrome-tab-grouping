import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { SharedChromeBridgeClient } from "../src/bridge/shared-client.js";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chrome-tab-bundle-smoke-"));
const suffix = `${process.pid}-${Date.now()}`;
const chromeEndpoint = process.platform === "win32"
  ? `\\\\.\\pipe\\chrome-tab-bundle-smoke-${suffix}`
  : path.join(directory, "chrome.sock");
const controlEndpoint = process.platform === "win32"
  ? `\\\\.\\pipe\\chrome-tab-bundle-smoke-control-${suffix}`
  : path.join(directory, "control.sock");
const child = spawn(process.execPath, ["dist/mcp.js"], {
  cwd: path.resolve("."),
  env: {
    ...process.env,
    CHROME_TAB_GROUPING_SOCKET: chromeEndpoint,
    CHROME_TAB_GROUPING_CONTROL_SOCKET: controlEndpoint,
  },
  stdio: ["pipe", "pipe", "pipe"],
});
const client = new SharedChromeBridgeClient({ controlSocketPath: controlEndpoint });

try {
  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "bundle-smoke", version: "1.0.0" },
    },
  })}\n`);
  const initialized = JSON.parse(await nextLine(child.stdout));
  if (initialized.result?.serverInfo?.name !== "chrome-tab-grouping") {
    throw new Error("The bundled MCP server did not initialize correctly.");
  }
  await client.start();
  child.kill("SIGTERM");
  await once(child, "exit");
  await client.shutdownDaemon();
  console.log("Bundled MCP and shared bridge smoke test passed.");
} finally {
  child.kill("SIGTERM");
  await client.close();
  await fs.rm(directory, { recursive: true, force: true });
}

function nextLine(stream, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("Timed out waiting for bundled MCP output.")), timeoutMs);
    const onData = (chunk) => {
      buffer += chunk;
      const boundary = buffer.indexOf("\n");
      if (boundary < 0) return;
      clearTimeout(timer);
      stream.off("data", onData);
      resolve(buffer.slice(0, boundary));
    };
    stream.setEncoding("utf8");
    stream.on("data", onData);
  });
}
