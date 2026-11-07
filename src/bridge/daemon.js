import fs from "node:fs/promises";
import net from "node:net";
import { ChromeBridgeBroker } from "./broker.js";
import {
  bridgeControlSocketIsFilesystem,
  bridgeControlSocketPath,
} from "./paths.js";

export const BRIDGE_PROTOCOL_VERSION = 1;

export class BridgeDaemonAlreadyRunningError extends Error {
  constructor() {
    super("A Chrome Tab Grouping bridge daemon is already running.");
    this.name = "BridgeDaemonAlreadyRunningError";
  }
}

export class ChromeBridgeDaemon {
  constructor({
    broker = new ChromeBridgeBroker(),
    controlSocketPath = bridgeControlSocketPath,
    controlSocketIsFilesystem = bridgeControlSocketIsFilesystem,
  } = {}) {
    this.broker = broker;
    this.controlSocketPath = controlSocketPath;
    this.controlSocketIsFilesystem = controlSocketIsFilesystem;
    this.server = null;
    this.clients = new Set();
    this.closePromise = null;
  }

  async start() {
    if (this.server) return;
    this.server = await this.#claimControlSocket();
    try {
      if (this.controlSocketIsFilesystem) {
        await fs.chmod(this.controlSocketPath, 0o600);
      }
      await this.broker.start();
    } catch (error) {
      await this.close().catch(() => {});
      throw error;
    }
  }

  async close() {
    if (this.closePromise) return await this.closePromise;
    this.closePromise = this.#close();
    return await this.closePromise;
  }

  async #close() {
    for (const client of this.clients) client.destroy();
    this.clients.clear();
    // Keep the control endpoint claimed until Chrome's endpoint has completely
    // closed. A replacement daemon cannot then rebind a pathname that Node is
    // still scheduled to remove during server shutdown.
    await this.broker.close();
    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve));
      this.server = null;
    }
  }

  async #claimControlSocket() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const server = net.createServer((socket) => this.#accept(socket));
      try {
        await listen(server, this.controlSocketPath, this.controlSocketIsFilesystem);
        return server;
      } catch (error) {
        server.close();
        if (error.code !== "EADDRINUSE") throw error;
        if (await endpointAcceptsConnections(this.controlSocketPath)) {
          throw new BridgeDaemonAlreadyRunningError();
        }
        if (!this.controlSocketIsFilesystem) throw error;
        const stat = await fs.lstat(this.controlSocketPath).catch((statError) => {
          if (statError.code === "ENOENT") return null;
          throw statError;
        });
        if (stat && !stat.isSocket()) {
          throw new Error(`Refusing to replace non-socket path: ${this.controlSocketPath}`);
        }
        await fs.unlink(this.controlSocketPath).catch((unlinkError) => {
          if (unlinkError.code !== "ENOENT") throw unlinkError;
        });
      }
    }
    throw new Error("Unable to claim the Chrome Tab Grouping bridge control socket.");
  }

  #accept(socket) {
    this.clients.add(socket);
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const boundary = buffer.indexOf("\n");
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 1);
        if (line) void this.#handleRequest(socket, line);
      }
    });
    const forget = () => this.clients.delete(socket);
    socket.on("close", forget);
    socket.on("error", forget);
  }

  async #handleRequest(socket, line) {
    let message;
    let shouldShutdown = false;
    try {
      message = JSON.parse(line);
      if (message.type !== "broker_request" || typeof message.requestId !== "string") {
        throw new Error("Invalid bridge control request.");
      }
      let result;
      if (message.method === "health") {
        result = { protocol_version: BRIDGE_PROTOCOL_VERSION, pid: process.pid };
      } else if (message.method === "shutdown") {
        result = { shutting_down: true };
        shouldShutdown = true;
      } else if (message.method === "list_profiles") {
        result = this.broker.listProfiles();
      } else if (message.method === "wait_for_profiles") {
        result = await this.broker.waitForProfiles(message.params?.timeout_ms);
      } else if (message.method === "request") {
        result = await this.broker.request(
          message.params?.profile_id,
          message.params?.action,
          message.params?.payload,
        );
      } else {
        throw new Error(`Unknown bridge control method: ${message.method}`);
      }
      writeLine(socket, {
        type: "broker_response",
        requestId: message.requestId,
        ok: true,
        result,
      });
      if (shouldShutdown) setTimeout(() => { void this.close(); }, 25);
    } catch (error) {
      writeLine(socket, {
        type: "broker_response",
        requestId: message?.requestId,
        ok: false,
        error: { name: error.name, message: error.message, code: error.code },
      });
    }
  }

}

function listen(server, socketPath, isFilesystem) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    const options = isFilesystem
      ? { path: socketPath }
      : { path: socketPath, readableAll: false, writableAll: false };
    server.listen(options);
  });
}

function endpointAcceptsConnections(socketPath, timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function writeLine(socket, value) {
  if (!socket.destroyed) socket.write(`${JSON.stringify(value)}\n`);
}
