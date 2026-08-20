import fs from "node:fs/promises";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { bridgeSocketPath } from "./paths.js";

export class BridgeUnavailableError extends Error {
  constructor(message = "The Chrome companion extension is unavailable.") {
    super(message);
    this.name = "BridgeUnavailableError";
  }
}

export class ChromeBridgeBroker {
  constructor({ socketPath = bridgeSocketPath, requestTimeoutMs = 15_000 } = {}) {
    this.socketPath = socketPath;
    this.requestTimeoutMs = requestTimeoutMs;
    this.server = null;
    this.profiles = new Map();
    this.pending = new Map();
  }

  async start() {
    if (this.server) return;
    await this.#removeStaleSocket();
    this.server = net.createServer((socket) => this.#accept(socket));
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.socketPath, () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    await fs.chmod(this.socketPath, 0o600);
  }

  async close() {
    for (const profile of this.profiles.values()) profile.socket.destroy();
    this.profiles.clear();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new BridgeUnavailableError("The Chrome bridge stopped before responding."));
    }
    this.pending.clear();
    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve));
      this.server = null;
    }
    await fs.unlink(this.socketPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  listProfiles() {
    return [...this.profiles.values()]
      .map(({ profileId, label, isDefault, connectedAt }) => ({ profile_id: profileId, label, is_default: isDefault, connected_at: connectedAt }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  async request(profileId, action, payload = {}) {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      const suffix = profileId ? ` for profile ${profileId}` : "";
      throw new BridgeUnavailableError(`Chrome is not connected${suffix}. Open Chrome with the extension enabled.`);
    }

    const requestId = randomUUID();
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new BridgeUnavailableError(`Chrome did not respond to ${action} within ${this.requestTimeoutMs}ms.`));
      }, this.requestTimeoutMs);
      this.pending.set(requestId, { resolve, reject, timer, profileId });
      profile.socket.write(`${JSON.stringify({ type: "request", requestId, action, payload })}\n`);
    });
  }

  async #removeStaleSocket() {
    const stat = await fs.lstat(this.socketPath).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!stat) return;
    if (!stat.isSocket()) throw new Error(`Refusing to replace non-socket path: ${this.socketPath}`);
    await fs.unlink(this.socketPath);
  }

  #accept(socket) {
    socket.setEncoding("utf8");
    let buffer = "";
    let registeredProfileId = null;

    const unregister = () => {
      if (registeredProfileId && this.profiles.get(registeredProfileId)?.socket === socket) {
        this.profiles.delete(registeredProfileId);
      }
    };

    socket.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const boundary = buffer.indexOf("\n");
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 1);
        if (!line) continue;
        try {
          const message = JSON.parse(line);
          if (message.type === "hello") {
            if (typeof message.profileId !== "string" || !message.profileId) throw new Error("Invalid profile hello");
            registeredProfileId = message.profileId;
            const previous = this.profiles.get(message.profileId);
            if (previous && previous.socket !== socket) previous.socket.destroy();
            this.profiles.set(message.profileId, {
              profileId: message.profileId,
              label: typeof message.label === "string" && message.label.trim() ? message.label.trim() : "Chrome profile",
              isDefault: Boolean(message.isDefault),
              connectedAt: new Date().toISOString(),
              socket,
            });
          } else if (message.type === "response") {
            this.#resolveResponse(message, registeredProfileId);
          }
        } catch (error) {
          socket.write(`${JSON.stringify({ type: "protocol_error", error: error.message })}\n`);
        }
      }
    });
    socket.on("close", unregister);
    socket.on("error", unregister);
  }

  #resolveResponse(message, profileId) {
    const pending = this.pending.get(message.requestId);
    if (!pending || pending.profileId !== profileId) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.requestId);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error?.message ?? "Chrome operation failed."));
  }
}
