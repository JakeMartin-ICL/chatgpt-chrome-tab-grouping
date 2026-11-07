import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";
import {
  BridgeDaemonAlreadyRunningError,
  ChromeBridgeDaemon,
} from "../src/bridge/daemon.js";
import { ChromeBridgeBroker } from "../src/bridge/broker.js";
import { SharedChromeBridgeClient } from "../src/bridge/shared-client.js";

test("multiple MCP clients share one Chrome connection without replacing its owner", async (t) => {
  const fixture = await sharedBridgeFixture("multi-client");
  const daemon = new ChromeBridgeDaemon({
    broker: new ChromeBridgeBroker({
      socketPath: fixture.chromeEndpoint,
      socketIsFilesystem: fixture.isFilesystem,
    }),
    controlSocketPath: fixture.controlEndpoint,
    controlSocketIsFilesystem: fixture.isFilesystem,
  });
  await daemon.start();

  const chrome = net.createConnection(fixture.chromeEndpoint);
  const first = new SharedChromeBridgeClient({ controlSocketPath: fixture.controlEndpoint });
  const second = new SharedChromeBridgeClient({ controlSocketPath: fixture.controlEndpoint });
  t.after(async () => {
    chrome.destroy();
    await first.close();
    await second.close();
    await daemon.close();
    await fixture.cleanup();
  });

  await once(chrome, "connect");
  chrome.setEncoding("utf8");
  chrome.write(`${JSON.stringify({
    type: "hello",
    profileId: "work",
    label: "Work",
    isDefault: false,
  })}\n`);
  assert.deepEqual(JSON.parse(await nextLine(chrome)), { type: "ready" });

  await Promise.all([first.start(), second.start()]);
  assert.equal((await first.listProfiles())[0].label, "Work");
  assert.equal((await second.listProfiles())[0].profile_id, "work");

  const inventoryPromise = second.request("work", "inventory");
  const request = JSON.parse(await nextLine(chrome));
  assert.equal(request.action, "inventory");
  chrome.write(`${JSON.stringify({
    type: "response",
    requestId: request.requestId,
    ok: true,
    result: { windows: [], groups: [], tabs: [] },
  })}\n`);
  assert.deepEqual(await inventoryPromise, { windows: [], groups: [], tabs: [] });

  await first.close();
  assert.equal((await second.listProfiles()).length, 1);
});

test("a second daemon cannot steal the live bridge endpoints", async (t) => {
  const fixture = await sharedBridgeFixture("owner");
  const first = daemonFor(fixture);
  const second = daemonFor(fixture);
  await first.start();
  t.after(async () => {
    await first.close();
    await fixture.cleanup();
  });

  await assert.rejects(second.start(), BridgeDaemonAlreadyRunningError);
  const chrome = net.createConnection(fixture.chromeEndpoint);
  await once(chrome, "connect");
  chrome.destroy();
});

test("the first MCP client starts a daemon and later clients reuse it", async (t) => {
  const fixture = await sharedBridgeFixture("lazy-start");
  let daemonProcess;
  const first = new SharedChromeBridgeClient({
    controlSocketPath: fixture.controlEndpoint,
    daemonEntrypoint: path.resolve("src/bridge/daemon-cli.js"),
    startDaemon(entrypoint) {
      daemonProcess = spawn(process.execPath, [entrypoint], {
        env: {
          ...process.env,
          CHROME_TAB_GROUPING_SOCKET: fixture.chromeEndpoint,
          CHROME_TAB_GROUPING_CONTROL_SOCKET: fixture.controlEndpoint,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
    },
  });
  const second = new SharedChromeBridgeClient({
    controlSocketPath: fixture.controlEndpoint,
    daemonEntrypoint: "must-not-be-used",
    startDaemon() { throw new Error("A second daemon was started."); },
  });
  t.after(async () => {
    await first.close();
    await second.close();
    daemonProcess?.kill("SIGTERM");
    if (daemonProcess && daemonProcess.exitCode === null) await once(daemonProcess, "exit");
    await fixture.cleanup();
  });

  await first.start();
  assert.ok(daemonProcess?.pid);
  await second.start();
  assert.deepEqual(await second.listProfiles(), []);
});

function daemonFor(fixture) {
  return new ChromeBridgeDaemon({
    broker: new ChromeBridgeBroker({
      socketPath: fixture.chromeEndpoint,
      socketIsFilesystem: fixture.isFilesystem,
    }),
    controlSocketPath: fixture.controlEndpoint,
    controlSocketIsFilesystem: fixture.isFilesystem,
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

async function sharedBridgeFixture(name) {
  if (process.platform === "win32") {
    const suffix = `${name}-${process.pid}-${Date.now()}`;
    return {
      chromeEndpoint: `\\\\.\\pipe\\chrome-tab-grouping-${suffix}`,
      controlEndpoint: `\\\\.\\pipe\\chrome-tab-grouping-control-${suffix}`,
      isFilesystem: false,
      async cleanup() {},
    };
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chrome-tab-shared-"));
  return {
    chromeEndpoint: path.join(directory, `${name}-chrome.sock`),
    controlEndpoint: path.join(directory, `${name}-control.sock`),
    isFilesystem: true,
    async cleanup() { await fs.rm(directory, { recursive: true, force: true }); },
  };
}
