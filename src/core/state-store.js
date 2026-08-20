import fs from "node:fs/promises";
import { undoStatePath } from "../bridge/paths.js";

export class UndoStore {
  constructor(filePath = undoStatePath) {
    this.filePath = filePath;
  }

  async load() {
    try {
      return JSON.parse(await fs.readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async save(record) {
    await fs.writeFile(this.filePath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    await fs.chmod(this.filePath, 0o600);
  }

  async clear() {
    await fs.unlink(this.filePath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
