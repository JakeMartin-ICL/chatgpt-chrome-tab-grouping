#!/usr/bin/env node
import net from "node:net";
import process from "node:process";
import { bridgeSocketPath } from "./paths.js";

const CONNECT_TIMEOUT_MS = 5_000;
let socket;
let socketConnected = false;
let socketBuffer = "";
let retryDelay = 100;
let retryDeadline = Date.now() + CONNECT_TIMEOUT_MS;
let retryTimer;
let stdinEnded = false;
let lastSocketError;
let registrationBody;
const pendingBodies = [];

let nativeBuffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  nativeBuffer = Buffer.concat([nativeBuffer, chunk]);
  while (nativeBuffer.length >= 4) {
    const length = nativeBuffer.readUInt32LE(0);
    if (length > 16 * 1024 * 1024) {
      process.stderr.write("Native message exceeds the companion's 16 MiB safety limit.\n");
      process.exit(1);
    }
    if (nativeBuffer.length < length + 4) return;
    const body = nativeBuffer.subarray(4, length + 4).toString("utf8");
    nativeBuffer = nativeBuffer.subarray(length + 4);
    try {
      if (JSON.parse(body).type === "hello") registrationBody = body;
    } catch {
      // The broker will return a protocol error for malformed JSON.
    }
    if (socketConnected) socket.write(`${body}\n`);
    else pendingBodies.push(body);
  }
});

function openBridgeSocket() {
  if (stdinEnded || socket) return;
  const candidate = net.createConnection(bridgeSocketPath);
  socket = candidate;
  candidate.setEncoding("utf8");
  candidate.on("connect", () => {
    if (socket !== candidate) return;
    socketConnected = true;
    retryDelay = 100;
    retryDeadline = Number.POSITIVE_INFINITY;
    const queuedBodies = pendingBodies.splice(0);
    if (registrationBody) candidate.write(`${registrationBody}\n`);
    for (const body of queuedBodies) {
      if (body !== registrationBody) candidate.write(`${body}\n`);
    }
  });
  candidate.on("data", handleBridgeData);
  candidate.on("error", (error) => { lastSocketError = error; });
  candidate.on("close", () => {
    if (socket !== candidate) return;
    const wasConnected = socketConnected;
    socket = undefined;
    socketConnected = false;
    socketBuffer = "";
    if (stdinEnded) return;
    if (wasConnected) retryDeadline = Date.now() + CONNECT_TIMEOUT_MS;
    scheduleSocketRetry();
  });
}

function handleBridgeData(chunk) {
  socketBuffer += chunk;
  while (socketBuffer.includes("\n")) {
    const boundary = socketBuffer.indexOf("\n");
    const line = socketBuffer.slice(0, boundary);
    socketBuffer = socketBuffer.slice(boundary + 1);
    if (!line) continue;
    const body = Buffer.from(line, "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    process.stdout.write(Buffer.concat([header, body]));
  }
}

function scheduleSocketRetry() {
  if (retryTimer || stdinEnded) return;
  if (Date.now() >= retryDeadline) {
    process.stderr.write(`Chrome Tab Grouping bridge unavailable: ${lastSocketError?.message ?? "connection timed out"}\n`);
    process.exit(1);
  }
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    openBridgeSocket();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 1_000);
}

process.stdin.on("end", () => {
  stdinEnded = true;
  if (retryTimer) clearTimeout(retryTimer);
  if (socketConnected) socket.end();
  else process.exit(0);
});

openBridgeSocket();
