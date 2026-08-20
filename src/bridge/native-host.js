#!/usr/bin/env node
import net from "node:net";
import process from "node:process";
import { bridgeSocketPath } from "./paths.js";

const socket = net.createConnection(bridgeSocketPath);
socket.setEncoding("utf8");

let nativeBuffer = Buffer.alloc(0);
let socketBuffer = "";

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
    socket.write(`${body}\n`);
  }
});

socket.on("data", (chunk) => {
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
});

socket.on("error", (error) => {
  process.stderr.write(`Chrome Tab Grouping bridge unavailable: ${error.message}\n`);
  process.exit(1);
});

process.stdin.on("end", () => socket.end());
