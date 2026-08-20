import { applyGroupingPlan, getInventory, undoGrouping } from "./operations.js";

const NATIVE_HOST = "com.openai.chrome_tab_grouping";
const RECONNECT_ALARM = "chrome-tab-grouping-reconnect";
let port;
let reconnectDelay = 1_000;

async function profileIdentity() {
  const stored = await chrome.storage.local.get(["profileId", "profileLabel", "profileDefault"]);
  const profileId = stored.profileId || crypto.randomUUID();
  const profileLabel = stored.profileLabel || "Chrome profile";
  if (!stored.profileId) await chrome.storage.local.set({ profileId });
  return { profileId, label: profileLabel, isDefault: Boolean(stored.profileDefault) };
}

async function connect() {
  if (port) return;
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST);
    port.onMessage.addListener(handleMessage);
    port.onDisconnect.addListener(() => {
      // Reading lastError marks expected offline states (host missing or MCP not
      // currently running) as handled instead of polluting the extension log.
      void chrome.runtime.lastError;
      port = undefined;
      scheduleReconnect();
    });
    port.postMessage({ type: "hello", ...(await profileIdentity()) });
    reconnectDelay = 1_000;
  } catch {
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  setTimeout(connect, reconnectDelay);
  chrome.alarms.create(RECONNECT_ALARM, { delayInMinutes: 0.5 });
  reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
}

async function handleMessage(message) {
  if (message.type !== "request" || !message.requestId) return;
  try {
    let result;
    if (message.action === "inventory") result = await getInventory();
    else if (message.action === "apply_plan") result = await applyGroupingPlan(message.payload);
    else if (message.action === "undo") result = await undoGrouping(message.payload);
    else throw new Error(`Unknown Chrome bridge action: ${message.action}`);
    port?.postMessage({ type: "response", requestId: message.requestId, ok: true, result });
  } catch (error) {
    port?.postMessage({
      type: "response",
      requestId: message.requestId,
      ok: false,
      error: { message: error.message, code: error.code ?? "CHROME_ERROR" },
    });
  }
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && (changes.profileLabel || changes.profileDefault) && port) {
    port.postMessage({ type: "hello", ...(await profileIdentity()) });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) connect();
});

connect();
