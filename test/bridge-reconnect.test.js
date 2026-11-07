import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";
import test from "node:test";
import { ChromeBridgeBroker } from "../src/bridge/broker.js";

test("broker acknowledges a profile and resolves connection waiters", async (t) => {
  const fixture = await bridgeFixture("broker-ready");
  const broker = new ChromeBridgeBroker({
    socketPath: fixture.endpoint,
    socketIsFilesystem: fixture.isFilesystem,
  });
  await broker.start();
  const client = net.createConnection(fixture.endpoint);
  t.after(async () => {
    client.destroy();
    await broker.close();
    await fixture.cleanup();
  });

  const waiting = broker.waitForProfiles(1_000);
  await once(client, "connect");
  client.setEncoding("utf8");
  client.write(`${JSON.stringify({ type: "hello", profileId: "personal", label: "Personal", isDefault: true })}\n`);

  assert.deepEqual(JSON.parse(await nextLine(client)), { type: "ready" });
  assert.deepEqual(await waiting, [{
    profile_id: "personal",
    label: "Personal",
    is_default: true,
    connected_at: broker.listProfiles()[0].connected_at,
  }]);
});

test("native host retries until a newly started broker is available", async (t) => {
  const fixture = await bridgeFixture("native-retry");
  const child = spawn(process.execPath, ["src/bridge/native-host.js"], {
    cwd: path.resolve("."),
    env: { ...process.env, CHROME_TAB_GROUPING_SOCKET: fixture.endpoint },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let accepted;
  let server;
  t.after(async () => {
    child.kill("SIGTERM");
    accepted?.destroy();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await fixture.cleanup();
  });

  const hello = JSON.stringify({ type: "hello", profileId: "delayed" });
  child.stdin.write(nativeFrame(hello));
  await delay(250);

  server = net.createServer((socket) => { accepted = socket; });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(fixture.endpoint, resolve);
  });
  while (!accepted) await delay(20);
  accepted.setEncoding("utf8");
  assert.equal(await nextLine(accepted), hello);

  accepted.write(`${JSON.stringify({ type: "ready" })}\n`);
  assert.deepEqual(JSON.parse((await nextNativeMessage(child.stdout)).toString("utf8")), { type: "ready" });
  child.stdin.end();
});

function nativeFrame(value) {
  const body = Buffer.from(value, "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

function nextNativeMessage(stream, timeoutMs = 3_000) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => reject(new Error("Timed out waiting for a native message.")), timeoutMs);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;
      const length = buffer.readUInt32LE(0);
      if (buffer.length < length + 4) return;
      clearTimeout(timer);
      stream.off("data", onData);
      resolve(buffer.subarray(4, length + 4));
    };
    stream.on("data", onData);
  });
}

function nextLine(stream, timeoutMs = 3_000) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("Timed out waiting for a bridge line.")), timeoutMs);
    const onData = (chunk) => {
      buffer += chunk;
      const boundary = buffer.indexOf("\n");
      if (boundary < 0) return;
      clearTimeout(timer);
      stream.off("data", onData);
      resolve(buffer.slice(0, boundary));
    };
    stream.on("data", onData);
  });
}

async function bridgeFixture(name) {
  if (process.platform === "win32") {
    return {
      endpoint: `\\\\.\\pipe\\chrome-tab-grouping-test-${name}-${process.pid}-${Date.now()}`,
      isFilesystem: false,
      async cleanup() {},
    };
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chrome-tab-bridge-"));
  return {
    endpoint: path.join(directory, `${name}.sock`),
    isFilesystem: true,
    async cleanup() { await fs.rm(directory, { recursive: true, force: true }); },
  };
}
