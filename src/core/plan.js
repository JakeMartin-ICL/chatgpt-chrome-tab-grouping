import { randomUUID } from "node:crypto";
import { rawById, requireRef } from "./inventory.js";

export const GROUP_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
export const PLAN_TTL_MS = 5 * 60 * 1000;

export function buildPlan(snapshot, input, now = Date.now()) {
  if (!Array.isArray(input.operations) || input.operations.length === 0) throw new Error("A grouping plan needs at least one operation.");
  const allowCrossWindow = Boolean(input.allow_cross_window);
  const createdKeys = new Set();
  const operations = [];
  const affectedTabIds = new Set();
  const affectedGroupIds = new Set();
  const warnings = [];

  for (const operation of input.operations) {
    switch (operation.type) {
      case "create_group": {
        if (!operation.group_key || createdKeys.has(operation.group_key)) throw new Error(`Duplicate or missing group_key: ${operation.group_key}`);
        createdKeys.add(operation.group_key);
        const windowId = requireRef(snapshot, "windows", operation.window_ref);
        const tabIds = resolveTabs(snapshot, operation.tab_refs);
        if (tabIds.length === 0) throw new Error("A new Chrome group must contain at least one tab.");
        enforceWindow(snapshot, tabIds, windowId, allowCrossWindow);
        tabIds.forEach((id) => affectedTabIds.add(id));
        operations.push({
          type: operation.type,
          groupKey: operation.group_key,
          windowId,
          tabIds,
          title: cleanTitle(operation.title),
          color: normalizeColor(operation.color),
          collapsed: Boolean(operation.collapsed),
        });
        break;
      }
      case "update_group": {
        const groupId = resolveMutableGroup(snapshot, operation.group_ref);
        affectedGroupIds.add(groupId);
        operations.push({
          type: operation.type,
          groupId,
          ...(operation.title !== undefined ? { title: cleanTitle(operation.title) } : {}),
          ...(operation.color !== undefined ? { color: normalizeColor(operation.color) } : {}),
          ...(operation.collapsed !== undefined ? { collapsed: Boolean(operation.collapsed) } : {}),
        });
        break;
      }
      case "assign_tabs": {
        const tabIds = resolveTabs(snapshot, operation.tab_refs);
        const target = resolveGroupTarget(snapshot, operation, createdKeys);
        if (target.groupId !== undefined) {
          const group = rawById(snapshot, "groups", target.groupId);
          enforceWindow(snapshot, tabIds, group.windowId, allowCrossWindow);
          affectedGroupIds.add(target.groupId);
        }
        tabIds.forEach((id) => affectedTabIds.add(id));
        operations.push({ type: operation.type, tabIds, ...target });
        break;
      }
      case "ungroup_tabs": {
        const tabIds = resolveTabs(snapshot, operation.tab_refs);
        tabIds.forEach((id) => affectedTabIds.add(id));
        operations.push({ type: operation.type, tabIds });
        break;
      }
      case "move_tabs": {
        if (!allowCrossWindow) throw new Error("Cross-window tab moves require allow_cross_window=true and an explicit user request.");
        const tabIds = resolveTabs(snapshot, operation.tab_refs);
        const windowId = requireRef(snapshot, "windows", operation.window_ref);
        tabIds.forEach((id) => affectedTabIds.add(id));
        operations.push({ type: operation.type, tabIds, windowId, index: normalizeIndex(operation.index) });
        break;
      }
      case "move_group": {
        if (!allowCrossWindow) throw new Error("Cross-window group moves require allow_cross_window=true and an explicit user request.");
        const groupId = resolveMutableGroup(snapshot, operation.group_ref);
        const windowId = requireRef(snapshot, "windows", operation.window_ref);
        affectedGroupIds.add(groupId);
        for (const tab of snapshot.raw.tabs.filter((candidate) => candidate.groupId === groupId)) affectedTabIds.add(tab.id);
        operations.push({ type: operation.type, groupId, windowId, index: normalizeIndex(operation.index) });
        break;
      }
      default:
        throw new Error(`Unsupported grouping operation: ${operation.type}`);
    }
  }

  for (const tabId of affectedTabIds) {
    const tab = rawById(snapshot, "tabs", tabId);
    if (tab.groupId !== -1) affectedGroupIds.add(tab.groupId);
  }

  protectActiveTab(snapshot, operations, warnings, input.keep_active_visible !== false);
  const automaticSweep = isAutomaticSweep(snapshot, operations);
  const summary = summarizePlan(snapshot, operations);

  return {
    id: randomUUID(),
    snapshotId: snapshot.id,
    profileId: snapshot.profile.profileId,
    createdAt: now,
    expiresAt: now + PLAN_TTL_MS,
    allowCrossWindow,
    operations,
    affectedTabIds: [...affectedTabIds],
    affectedGroupIds: [...affectedGroupIds],
    expected: {
      tabs: snapshot.raw.tabs.filter((tab) => affectedTabIds.has(tab.id)),
      groups: snapshot.raw.groups.filter((group) => affectedGroupIds.has(group.id)),
    },
    automaticSweep,
    requiresConfirmation: !automaticSweep,
    warnings,
    summary,
  };
}

function resolveTabs(snapshot, refs) {
  if (!Array.isArray(refs) || refs.length === 0) throw new Error("Operation requires at least one tab_ref.");
  return [...new Set(refs.map((ref) => requireRef(snapshot, "tabs", ref)))];
}

function resolveMutableGroup(snapshot, ref) {
  const groupId = requireRef(snapshot, "groups", ref);
  const group = rawById(snapshot, "groups", groupId);
  if (group.shared) throw new Error(`Shared group “${group.title || "Untitled group"}” is protected in v1.`);
  return groupId;
}

function resolveGroupTarget(snapshot, operation, createdKeys) {
  const hasExisting = Boolean(operation.group_ref);
  const hasCreated = Boolean(operation.group_key);
  if (hasExisting === hasCreated) throw new Error("assign_tabs requires exactly one of group_ref or group_key.");
  if (hasExisting) return { groupId: resolveMutableGroup(snapshot, operation.group_ref) };
  if (!createdKeys.has(operation.group_key)) throw new Error(`assign_tabs references group_key before it is created: ${operation.group_key}`);
  return { groupKey: operation.group_key };
}

function enforceWindow(snapshot, tabIds, windowId, allowCrossWindow) {
  const outside = tabIds.filter((id) => rawById(snapshot, "tabs", id).windowId !== windowId);
  if (outside.length && !allowCrossWindow) throw new Error("A group cannot span windows. Cross-window movement was not explicitly allowed.");
}

function protectActiveTab(snapshot, operations, warnings, enabled) {
  if (!enabled) return;
  const activeIds = new Set(snapshot.raw.tabs.filter((tab) => tab.active).map((tab) => tab.id));
  for (const operation of operations) {
    if (operation.type === "create_group" && operation.collapsed && operation.tabIds.some((id) => activeIds.has(id))) {
      operation.collapsed = false;
      warnings.push("Kept a new group expanded because it contains an active tab.");
    }
    if (operation.type === "update_group" && operation.collapsed) {
      const containsActive = snapshot.raw.tabs.some((tab) => tab.groupId === operation.groupId && activeIds.has(tab.id));
      if (containsActive) {
        operation.collapsed = false;
        warnings.push("Kept an existing group expanded because it contains an active tab.");
      }
    }
    if (operation.type === "assign_tabs" && operation.groupId !== undefined && operation.tabIds.some((id) => activeIds.has(id))) {
      const group = rawById(snapshot, "groups", operation.groupId);
      if (group.collapsed) {
        operation.expandTarget = true;
        warnings.push("Expanded the destination group because an active tab is being added to it.");
      }
    }
  }
}

function isAutomaticSweep(snapshot, operations) {
  return operations.every((operation) => {
    if (operation.type !== "assign_tabs" || operation.groupId === undefined) return false;
    return operation.tabIds.every((id) => rawById(snapshot, "tabs", id).groupId === -1);
  });
}

function summarizePlan(snapshot, operations) {
  return operations.map((operation) => {
    if (operation.type === "create_group") return { action: "create", group: operation.title || "Untitled group", tab_count: operation.tabIds.length, collapsed: operation.collapsed };
    if (operation.type === "update_group") return { action: "update", group: rawById(snapshot, "groups", operation.groupId).title || "Untitled group" };
    if (operation.type === "assign_tabs") {
      const name = operation.groupId === undefined ? operation.groupKey : rawById(snapshot, "groups", operation.groupId).title || "Untitled group";
      return { action: "add", group: name, tab_count: operation.tabIds.length };
    }
    if (operation.type === "ungroup_tabs") return { action: "ungroup", tab_count: operation.tabIds.length };
    if (operation.type === "move_tabs") return { action: "move_tabs", tab_count: operation.tabIds.length };
    return { action: "move_group", group: rawById(snapshot, "groups", operation.groupId).title || "Untitled group" };
  });
}

function cleanTitle(value) {
  if (value === undefined || value === null) return "";
  const title = String(value).trim();
  if (title.length > 128) throw new Error("Group titles must be 128 characters or fewer.");
  return title;
}

function normalizeColor(value) {
  const color = value ?? "grey";
  if (!GROUP_COLORS.includes(color)) throw new Error(`Unsupported Chrome group color: ${color}`);
  return color;
}

function normalizeIndex(value) {
  if (value === undefined) return -1;
  if (!Number.isInteger(value) || value < -1) throw new Error("Move index must be -1 or a non-negative integer.");
  return value;
}

export function publicPlan(plan) {
  return {
    plan_id: plan.id,
    expires_at: new Date(plan.expiresAt).toISOString(),
    summary: plan.summary,
    warnings: plan.warnings,
    automatic_sweep: plan.automaticSweep,
    requires_confirmation: plan.requiresConfirmation,
  };
}

export function validateAuthorization(plan, authorization) {
  if (!["automatic_sweep", "preapproved", "confirmed"].includes(authorization)) throw new Error("Invalid authorization mode.");
  if (authorization === "automatic_sweep" && !plan.automaticSweep) {
    throw new Error("This plan changes more than ungrouped membership in existing groups and cannot be auto-applied.");
  }
}
