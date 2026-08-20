import os from "node:os";
import path from "node:path";

const uid = typeof process.getuid === "function" ? process.getuid() : os.userInfo().username;

export const bridgeSocketPath = process.env.CHROME_TAB_GROUPING_SOCKET
  ?? path.join(os.tmpdir(), `chatgpt-chrome-tab-grouping-${uid}.sock`);

export const undoStatePath = process.env.CHROME_TAB_GROUPING_UNDO_FILE
  ?? path.join(os.tmpdir(), `chatgpt-chrome-tab-grouping-undo-${uid}.json`);
