import { randomBytes, randomUUID } from "node:crypto";

function opaqueRef(prefix) {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

export function createSnapshot(profile, rawInventory, now = Date.now()) {
  const snapshot = {
    id: randomUUID(),
    createdAt: now,
    profile: { profileId: profile.profile_id, label: profile.label },
    raw: structuredClone(rawInventory),
    refs: { tabs: new Map(), groups: new Map(), windows: new Map() },
    reverse: { tabs: new Map(), groups: new Map(), windows: new Map() },
  };

  for (const window of rawInventory.windows ?? []) addRef(snapshot, "windows", window.id, opaqueRef("window"));
  for (const group of rawInventory.groups ?? []) addRef(snapshot, "groups", group.id, opaqueRef("group"));
  for (const tab of rawInventory.tabs ?? []) addRef(snapshot, "tabs", tab.id, opaqueRef("tab"));
  return snapshot;
}

function addRef(snapshot, kind, id, ref) {
  snapshot.refs[kind].set(ref, id);
  snapshot.reverse[kind].set(id, ref);
}

export function serializeSnapshot(snapshot, { scope = "summary", cursor = 0, limit = 100, windowRef, groupRef } = {}) {
  const groups = snapshot.raw.groups.map((group) => ({
    ref: snapshot.reverse.groups.get(group.id),
    window_ref: snapshot.reverse.windows.get(group.windowId),
    title: group.title || "Untitled group",
    color: group.color,
    collapsed: group.collapsed,
    shared: Boolean(group.shared),
    tab_count: snapshot.raw.tabs.filter((tab) => tab.groupId === group.id).length,
  }));
  const windows = snapshot.raw.windows.map((window) => ({
    ref: snapshot.reverse.windows.get(window.id),
    focused: Boolean(window.focused),
    tab_count: snapshot.raw.tabs.filter((tab) => tab.windowId === window.id).length,
    group_count: snapshot.raw.groups.filter((group) => group.windowId === window.id).length,
  }));

  let candidates = [];
  if (scope !== "summary") {
    candidates = snapshot.raw.tabs;
    if (scope === "ungrouped") candidates = candidates.filter((tab) => tab.groupId === -1);
    if (scope === "window") {
      const windowId = requireRef(snapshot, "windows", windowRef);
      candidates = candidates.filter((tab) => tab.windowId === windowId);
    }
    if (scope === "group") {
      const groupId = requireRef(snapshot, "groups", groupRef);
      candidates = candidates.filter((tab) => tab.groupId === groupId);
    }
  }

  const offset = Number(cursor) || 0;
  const page = candidates.slice(offset, offset + limit).map((tab) => serializeTab(snapshot, tab));
  const nextCursor = offset + page.length < candidates.length ? String(offset + page.length) : null;
  const ungrouped = snapshot.raw.tabs.filter((tab) => tab.groupId === -1);

  return {
    snapshot_id: snapshot.id,
    captured_at: new Date(snapshot.createdAt).toISOString(),
    profile: { profile_id: snapshot.profile.profileId, label: snapshot.profile.label },
    totals: {
      windows: snapshot.raw.windows.length,
      tabs: snapshot.raw.tabs.length,
      groups: snapshot.raw.groups.length,
      ungrouped_tabs: ungrouped.length,
    },
    windows,
    groups,
    tabs: page,
    next_cursor: nextCursor,
  };
}

function serializeTab(snapshot, tab) {
  return {
    ref: snapshot.reverse.tabs.get(tab.id),
    title: tab.title || "Untitled tab",
    url: tab.url || "",
    window_ref: snapshot.reverse.windows.get(tab.windowId),
    position: tab.index,
    group_ref: tab.groupId === -1 ? null : snapshot.reverse.groups.get(tab.groupId),
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    discarded: Boolean(tab.discarded),
  };
}

export function requireRef(snapshot, kind, ref) {
  const id = snapshot.refs[kind].get(ref);
  if (id === undefined) throw new Error(`Unknown or stale ${kind.slice(0, -1)} reference: ${ref}`);
  return id;
}

export function rawById(snapshot, kind, id) {
  const singular = kind.slice(0, -1);
  const value = snapshot.raw[kind].find((item) => item.id === id);
  if (!value) throw new Error(`Snapshot is missing ${singular} ${id}.`);
  return value;
}
