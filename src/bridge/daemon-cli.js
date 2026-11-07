#!/usr/bin/env node
import process from "node:process";
import {
  BridgeDaemonAlreadyRunningError,
  ChromeBridgeDaemon,
} from "./daemon.js";

const daemon = new ChromeBridgeDaemon();

try {
  await daemon.start();
} catch (error) {
  if (error instanceof BridgeDaemonAlreadyRunningError) process.exit(0);
  throw error;
}

async function shutdown() {
  await daemon.close().catch(() => {});
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
