import { createSnapshot, serializeSnapshot } from "../core/inventory.js";
import { buildPlan, publicPlan, validateAuthorization } from "../core/plan.js";
import { UndoStore } from "../core/state-store.js";

export class TabGroupingService {
  constructor({ broker, undoStore = new UndoStore(), now = () => Date.now() }) {
    this.broker = broker;
    this.undoStore = undoStore;
    this.now = now;
    this.snapshots = new Map();
    this.plans = new Map();
  }

  listProfiles() {
    const profiles = this.broker.listProfiles();
    const defaults = profiles.filter((profile) => profile.is_default);
    return {
      profiles,
      connected_count: profiles.length,
      selection_hint: profiles.length === 0
        ? "Open Chrome with the companion extension enabled."
          : profiles.length === 1
          ? "This is the only connected profile and may be selected automatically."
          : defaults.length === 1
            ? `The default profile is ${defaults[0].label}. Acting across profiles requires an explicit user request.`
            : "Select a profile explicitly. Acting across profiles requires an explicit user request.",
    };
  }

  async listTabs(input = {}) {
    this.#prune();
    let snapshot;
    if (input.snapshot_id) {
      snapshot = this.snapshots.get(input.snapshot_id);
      if (!snapshot) throw new Error("Unknown or expired snapshot. Refresh the Chrome tab inventory.");
    } else {
      const profile = this.#selectProfile(input.profile_id);
      const inventory = await this.broker.request(profile.profile_id, "inventory");
      snapshot = createSnapshot(profile, inventory, this.now());
      this.snapshots.set(snapshot.id, snapshot);
    }
    return serializeSnapshot(snapshot, {
      scope: input.scope ?? "summary",
      cursor: input.cursor ?? 0,
      limit: Math.min(Math.max(input.limit ?? 100, 1), 200),
      windowRef: input.window_ref,
      groupRef: input.group_ref,
    });
  }

  preview(input) {
    this.#prune();
    const snapshot = this.snapshots.get(input.snapshot_id);
    if (!snapshot) throw new Error("Unknown or expired snapshot. Refresh the Chrome tab inventory.");
    const plan = buildPlan(snapshot, input, this.now());
    this.plans.set(plan.id, plan);
    return publicPlan(plan);
  }

  async apply(input) {
    this.#prune();
    const plan = this.plans.get(input.plan_id);
    if (!plan) throw new Error("Unknown or expired plan. Refresh the inventory and preview again.");
    if (this.now() > plan.expiresAt) {
      this.plans.delete(plan.id);
      throw new Error("The grouping plan expired. Refresh the inventory and preview again.");
    }
    validateAuthorization(plan, input.authorization);
    const result = await this.broker.request(plan.profileId, "apply_plan", {
      expected: plan.expected,
      operations: plan.operations,
      affectedTabIds: plan.affectedTabIds,
      affectedGroupIds: plan.affectedGroupIds,
    });
    const record = {
      version: 1,
      profileId: plan.profileId,
      appliedAt: new Date(this.now()).toISOString(),
      before: result.before,
      after: result.after,
      affectedTabIds: result.affectedTabIds,
      affectedGroupIds: result.affectedGroupIds,
      createdGroupIds: result.createdGroupIds,
    };
    await this.undoStore.save(record);
    this.plans.delete(plan.id);
    return {
      applied: true,
      summary: plan.summary,
      warnings: plan.warnings,
      undo_available: true,
    };
  }

  async undo() {
    const record = await this.undoStore.load();
    if (!record) throw new Error("There is no grouping operation available to undo.");
    const result = await this.broker.request(record.profileId, "undo", record);
    await this.undoStore.clear();
    return { undone: true, ...result };
  }

  #selectProfile(profileId) {
    const profiles = this.broker.listProfiles();
    if (profileId) {
      const profile = profiles.find((candidate) => candidate.profile_id === profileId);
      if (!profile) throw new Error(`Chrome profile is not connected: ${profileId}`);
      return profile;
    }
    if (profiles.length === 1) return profiles[0];
    if (profiles.length === 0) throw new Error("Chrome is unavailable. Open Chrome with the companion extension enabled.");
    const defaults = profiles.filter((profile) => profile.is_default);
    if (defaults.length === 1) return defaults[0];
    if (defaults.length > 1) throw new Error("Multiple connected Chrome profiles are marked as default. Select one profile explicitly.");
    throw new Error("Multiple Chrome profiles are connected. Select one profile explicitly.");
  }

  #prune() {
    const now = this.now();
    for (const [id, snapshot] of this.snapshots) {
      if (now - snapshot.createdAt > 10 * 60 * 1000) this.snapshots.delete(id);
    }
    for (const [id, plan] of this.plans) {
      if (now > plan.expiresAt) this.plans.delete(id);
    }
  }
}
