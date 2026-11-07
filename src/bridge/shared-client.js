import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import net from "node:net";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { BRIDGE_PROTOCOL_VERSION } from "./daemon.js";
import { bridgeControlSocketPath } from "./paths.js";

const START_TIMEOUT_MS = 5_000;

export class SharedChromeBridgeClient {
  constructor({
    controlSocketPath = bridgeControlSocketPath,
    daemonEntrypoint,
    startDaemon = defaultStartDaemon,
  } = {}) {
    this.controlSocketPath = controlSocketPath;
    this.daemonEntrypoint = daemonEntrypoint;
    this.startDaemon = startDaemon;
    this.socket = null;
    this.buffer = "";
    this.pending = new Map();
    this.connectionAttempt = null;
    this.closed = false;
  }

  async start() {
    await this.#ensureConnection();
    const health = await this.#call("health");
    if (health.protocol_version !== BRIDGE_PROTOCOL_VERSION) {
      throw new Error(
        `Chrome bridge protocol mismatch: expected ${BRIDGE_PROTOCOL_VERSION}, received ${health.protocol_version}.`,
      );
    }
  }

  async close() {
    this.closed = true;
    this.socket?.destroy();
    this.socket = null;
    this.#rejectPending(new Error("The Chrome bridge client closed."));
  }

  async listProfiles() {
    return await this.#call("list_profiles");
  }

  async waitForProfiles(timeoutMs = 5_000) {
    return await this.#call("wait_for_profiles", { timeout_ms: timeoutMs });
  }

  async request(profileId, action, payload = {}) {
    return await this.#call("request", {
      profile_id: profileId,
      action,
      payload,
    });
  }

  async shutdownDaemon() {
    return await this.#call("shutdown");
  }

  async #call(method, params = {}) {
    await this.#ensureConnection();
    const requestId = randomUUID();
    return await new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.socket.write(`${JSON.stringify({
        type: "broker_request",
        requestId,
        method,
        params,
      })}\n`, (error) => {
        if (!error) return;
        this.pending.delete(requestId);
        reject(error);
      });
    });
  }

  async #ensureConnection() {
    if (this.closed) throw new Error("The Chrome bridge client is closed.");
    if (this.socket && !this.socket.destroyed) return;
    if (this.connectionAttempt) return await this.connectionAttempt;
    this.connectionAttempt = this.#connectOrStart().finally(() => {
      this.connectionAttempt = null;
    });
    return await this.connectionAttempt;
  }

  async #connectOrStart() {
    let socket = await tryConnect(this.controlSocketPath, 250);
    if (!socket) {
      if (!this.daemonEntrypoint) throw new Error("The Chrome bridge daemon entrypoint is unavailable.");
      this.startDaemon(this.daemonEntrypoint);
      const deadline = Date.now() + START_TIMEOUT_MS;
      while (!socket && Date.now() < deadline) {
        await delay(50);
        socket = await tryConnect(this.controlSocketPath, 250);
      }
    }
    if (!socket) throw new Error("The shared Chrome bridge did not start within 5000ms.");
    this.#attach(socket);
  }

  #attach(socket) {
    this.socket = socket;
    this.buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      this.buffer += chunk;
      while (this.buffer.includes("\n")) {
        const boundary = this.buffer.indexOf("\n");
        const line = this.buffer.slice(0, boundary);
        this.buffer = this.buffer.slice(boundary + 1);
        if (line) this.#handleResponse(line);
      }
    });
    const disconnect = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.buffer = "";
      this.#rejectPending(new Error("The shared Chrome bridge disconnected before responding."));
    };
    socket.on("close", disconnect);
    socket.on("error", disconnect);
  }

  #handleResponse(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.type !== "broker_response") return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    if (message.ok) pending.resolve(message.result);
    else {
      const error = new Error(message.error?.message ?? "Chrome bridge request failed.");
      if (message.error?.name) error.name = message.error.name;
      if (message.error?.code) error.code = message.error.code;
      pending.reject(error);
    }
  }

  #rejectPending(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function tryConnect(socketPath, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off("connect", onConnect);
      socket.off("error", onError);
      if (!result) socket.destroy();
      resolve(result ? socket : null);
    };
    const onConnect = () => finish(true);
    const onError = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}

function defaultStartDaemon(entrypoint) {
  const child = spawn(process.execPath, [entrypoint], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: process.env,
  });
  child.unref();
}
