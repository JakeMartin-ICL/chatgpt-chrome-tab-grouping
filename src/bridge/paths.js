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
    ? `\\\\.\\pipe\\chatgpt-chrome-tab-grouping-${suffix}`
    : path.posix.join(tempDir, `chatgpt-chrome-tab-grouping-${suffix}.sock`);
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

export const bridgeSocketIsFilesystem = process.platform !== "win32"
  && !bridgeSocketPath.startsWith("\\\\.\\pipe\\");

export const undoStatePath = process.env.CHROME_TAB_GROUPING_UNDO_FILE
  ?? undoStatePathFor();
