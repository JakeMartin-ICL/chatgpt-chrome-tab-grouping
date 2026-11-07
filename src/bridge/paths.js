import os from "node:os";
import path from "node:path";

function currentIdentity() {
  return typeof process.getuid === "function" ? String(process.getuid()) : os.userInfo().username;
}

function safeIdentity(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]/g, "-");
}

export function bridgeEndpointFor({
  platform = process.platform,
  tempDir = os.tmpdir(),
  identity = currentIdentity(),
} = {}) {
  const suffix = safeIdentity(identity);
  return platform === "win32"
    ? `\\\\.\\pipe\\chatgpt-chrome-tab-grouping-v2-${suffix}`
    : path.posix.join(tempDir, `chatgpt-chrome-tab-grouping-v2-${suffix}.sock`);
}

export function bridgeControlEndpointFor({
  platform = process.platform,
  tempDir = os.tmpdir(),
  identity = currentIdentity(),
} = {}) {
  const suffix = safeIdentity(identity);
  return platform === "win32"
    ? `\\\\.\\pipe\\chatgpt-chrome-tab-grouping-control-v2-${suffix}`
    : path.posix.join(tempDir, `chatgpt-chrome-tab-grouping-control-v2-${suffix}.sock`);
}

export function bridgeDaemonLockPathFor({
  tempDir = os.tmpdir(),
  identity = currentIdentity(),
} = {}) {
  return path.join(tempDir, `chatgpt-chrome-tab-grouping-daemon-${safeIdentity(identity)}.lock`);
}

export function undoStatePathFor({
  platform = process.platform,
  tempDir = os.tmpdir(),
  identity = currentIdentity(),
} = {}) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  return pathApi.join(tempDir, `chatgpt-chrome-tab-grouping-undo-${safeIdentity(identity)}.json`);
}

export const bridgeSocketPath = process.env.CHROME_TAB_GROUPING_SOCKET
  ?? bridgeEndpointFor();

export const bridgeControlSocketPath = process.env.CHROME_TAB_GROUPING_CONTROL_SOCKET
  ?? bridgeControlEndpointFor();

export const bridgeDaemonLockPath = process.env.CHROME_TAB_GROUPING_DAEMON_LOCK
  ?? bridgeDaemonLockPathFor();

export const bridgeSocketIsFilesystem = process.platform !== "win32"
  && !bridgeSocketPath.startsWith("\\\\.\\pipe\\");

export const bridgeControlSocketIsFilesystem = process.platform !== "win32"
  && !bridgeControlSocketPath.startsWith("\\\\.\\pipe\\");

export const undoStatePath = process.env.CHROME_TAB_GROUPING_UNDO_FILE
  ?? undoStatePathFor();
