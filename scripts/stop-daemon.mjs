import { SharedChromeBridgeClient } from "../src/bridge/shared-client.js";

const client = new SharedChromeBridgeClient();

try {
  await client.start();
  await client.shutdownDaemon();
  console.log("Stopped the shared Chrome Tab Grouping bridge.");
} catch (error) {
  if (!error.message.includes("daemon entrypoint is unavailable")) throw error;
  console.log("The shared Chrome Tab Grouping bridge was not running.");
} finally {
  await client.close();
}
