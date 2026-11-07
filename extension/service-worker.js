import { applyGroupingPlan, getInventory, undoGrouping } from "./operations.js";

const NATIVE_HOST = "com.openai.chrome_tab_grouping";
const RECONNECT_ALARM = "chrome-tab-grouping-reconnect";
const RECONNECT_ALARM_MINUTES = 0.5;
let port;
let connected = false;
let connectionAttempt;
let reconnectTimer;
let reconnectDelay = 1_000;
const readyWaiters = new Set();

async function profileIdentity() {
  const stored = await chrome.storage.local.get(["profileId", "profileLabel", "profileDefault"]);
  const profileId = stored.profileId || crypto.randomUUID();
  const profileLabel = stored.profileLabel || "Chrome profile";
  if (!stored.profileId) await chrome.storage.local.set({ profileId });
  return { profileId, label: profileLabel, isDefault: Boolean(stored.profileDefault) };
}

async function connect() {
  if (port) return connectionStatus();
  if (connectionAttempt) return connectionAttempt;
  connectionAttempt = performConnect().finally(() => { connectionAttempt = undefined; });
  return connectionAttempt;
}

async function performConnect() {
  await ensureReconnectAlarm();
  try {
    const candidate = chrome.runtime.connectNative(NATIVE_HOST);
    port = candidate;
    connected = false;
    candidate.onMessage.addListener(handleMessage);
    candidate.onDisconnect.addListener(() => {
      if (port !== candidate) return;
      // Reading lastError marks expected offline states (host missing or MCP not
      // currently running) as handled instead of polluting the extension log.
      void chrome.runtime.lastError;
      port = undefined;
      connected = false;
      settleReadyWaiters(false);
      scheduleReconnect();
    });
    const identity = await profileIdentity();
    if (port === candidate) candidate.postMessage({ type: "hello", ...identity });
  } catch {
    port = undefined;
    connected = false;
    scheduleReconnect();
  }
  return connectionStatus();
}

function scheduleReconnect() {
  void ensureReconnectAlarm();
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    void connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
}

async function ensureReconnectAlarm() {
  const alarm = await chrome.alarms.get(RECONNECT_ALARM);
  if (!alarm?.periodInMinutes) {
    await chrome.alarms.create(RECONNECT_ALARM, {
      delayInMinutes: RECONNECT_ALARM_MINUTES,
      periodInMinutes: RECONNECT_ALARM_MINUTES,
    });
  }
}

async function reconnectNow() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
  // Let a startup attempt finish before replacing its port. Otherwise its
  // finally handler can race with the explicit reconnect attempt.
  if (connectionAttempt) await connectionAttempt.catch(() => {});
  const previous = port;
  port = undefined;
  connected = false;
  previous?.disconnect();
  await connect();
  if (!connected) await waitUntilReady(3_000);
  return connectionStatus();
}

function connectionStatus() {
  return { status: connected ? "connected" : port ? "connecting" : "disconnected" };
}

function waitUntilReady(timeoutMs) {
  if (connected) return Promise.resolve(true);
  return new Promise((resolve) => {
    const waiter = { resolve, timer: setTimeout(() => {
      readyWaiters.delete(waiter);
      resolve(false);
    }, timeoutMs) };
    readyWaiters.add(waiter);
  });
}

function settleReadyWaiters(value) {
  for (const waiter of readyWaiters) {
    clearTimeout(waiter.timer);
    waiter.resolve(value);
  }
  readyWaiters.clear();
}

async function handleMessage(message) {
  if (message.type === "ready") {
    connected = true;
    reconnectDelay = 1_000;
    await chrome.alarms.clear(RECONNECT_ALARM);
    settleReadyWaiters(true);
    return;
  }
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
  if (alarm.name === RECONNECT_ALARM) void connect();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "connection_status") {
    sendResponse(connectionStatus());
    return false;
  }
  if (message?.type === "reconnect_now") {
    reconnectNow().then(sendResponse, (error) => sendResponse({ status: "disconnected", error: error.message }));
    return true;
  }
  return false;
});

chrome.runtime.onStartup.addListener(() => { void connect(); });

void connect();
