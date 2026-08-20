#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ChromeBridgeBroker } from "../bridge/broker.js";
import { TabGroupingService } from "./service.js";
import { createMcpServer } from "./server.js";

const broker = process.env.CHROME_TAB_GROUPING_DISABLE_BRIDGE === "1"
  ? new DisabledBridgeBroker()
  : new ChromeBridgeBroker();
await broker.start();

const service = new TabGroupingService({ broker });
const server = createMcpServer(service);
const transport = new StdioServerTransport();
await server.connect(transport);

async function shutdown() {
  await broker.close().catch(() => {});
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

function DisabledBridgeBroker() {
  return {
    async start() {},
    async close() {},
    listProfiles() { return []; },
    async request() { throw new Error("Chrome bridge is disabled."); },
  };
}
