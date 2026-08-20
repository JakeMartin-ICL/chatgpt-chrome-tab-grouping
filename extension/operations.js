export async function getInventory(chromeApi = chrome) {
  const windows = await chromeApi.windows.getAll({ windowTypes: ["normal"] });
  const windowIds = new Set(windows.map((window) => window.id));
  const [tabs, groups] = await Promise.all([
    chromeApi.tabs.query({}),
    chromeApi.tabGroups.query({}),
  ]);
  return {
    windows: windows.map((window) => ({ id: window.id, focused: window.focused, type: window.type })),
    tabs: tabs.filter((tab) => windowIds.has(tab.windowId)).map(tabRecord),
    groups: groups.filter((group) => windowIds.has(group.windowId)).map(groupRecord),
  };
}

export async function applyGroupingPlan(payload, chromeApi = chrome) {
  const current = await getInventory(chromeApi);
  validateExpectedState(current, payload.expected);
  const before = current;
  const createdGroups = new Map();

  try {
    for (const operation of payload.operations) {
      await executeOperation(operation, createdGroups, chromeApi);
    }
  } catch (error) {
    await restoreSnapshot(before, payload.affectedTabIds, payload.affectedGroupIds, chromeApi).catch(() => {});
    throw new Error(`Grouping failed and rollback was attempted: ${error.message}`);
  }

  const after = await getInventory(chromeApi);
  return {
    before,
    after,
    affectedTabIds: payload.affectedTabIds,
    affectedGroupIds: [...new Set([...payload.affectedGroupIds, ...createdGroups.values()])],
    createdGroupIds: [...createdGroups.values()],
  };
}

export async function undoGrouping(record, chromeApi = chrome) {
  const current = await getInventory(chromeApi);
  validateUndoState(current, record);
  await restoreSnapshot(record.before, record.affectedTabIds, record.affectedGroupIds, chromeApi);
  return { restored: true, affected_tabs: record.affectedTabIds.length };
}

export function validateExpectedState(current, expected) {
  const tabs = new Map(current.tabs.map((tab) => [tab.id, tab]));
  for (const wanted of expected.tabs ?? []) {
    const actual = tabs.get(wanted.id);
    if (!actual) throw stale(`Tab ${wanted.id} is no longer open.`);
    for (const key of ["windowId", "index", "url", "groupId"]) {
      if (actual[key] !== wanted[key]) throw stale(`Tab “${wanted.title || wanted.url}” changed ${key}.`);
    }
  }
  const groups = new Map(current.groups.map((group) => [group.id, group]));
  for (const wanted of expected.groups ?? []) {
    const actual = groups.get(wanted.id);
    if (!actual) throw stale(`Group “${wanted.title || "Untitled group"}” no longer exists.`);
    for (const key of ["windowId", "title", "color", "collapsed", "shared"]) {
      if (actual[key] !== wanted[key]) throw stale(`Group “${wanted.title || "Untitled group"}” changed ${key}.`);
    }
  }
}

function validateUndoState(current, record) {
  const expectedTabs = record.after.tabs.filter((tab) => record.affectedTabIds.includes(tab.id));
  const expectedGroups = record.after.groups.filter((group) => record.affectedGroupIds.includes(group.id));
  try {
    validateExpectedState(current, { tabs: expectedTabs, groups: expectedGroups });
  } catch (error) {
    throw new Error(`Undo was not applied because Chrome changed after the grouping operation: ${error.message}`);
  }
}

async function executeOperation(operation, createdGroups, chromeApi) {
  switch (operation.type) {
    case "create_group": {
      await moveTabsToWindow(operation.tabIds, operation.windowId, chromeApi);
      const groupId = await chromeApi.tabs.group({
        tabIds: operation.tabIds,
        createProperties: { windowId: operation.windowId },
      });
      createdGroups.set(operation.groupKey, groupId);
      await chromeApi.tabGroups.update(groupId, {
        title: operation.title,
        color: operation.color,
        collapsed: operation.collapsed,
      });
      return;
    }
    case "update_group":
      await chromeApi.tabGroups.update(operation.groupId, pick(operation, ["title", "color", "collapsed"]));
      return;
    case "assign_tabs": {
      const groupId = operation.groupId ?? createdGroups.get(operation.groupKey);
      if (groupId === undefined) throw new Error(`New group key was not created: ${operation.groupKey}`);
      const target = await chromeApi.tabGroups.get(groupId);
      await moveTabsToWindow(operation.tabIds, target.windowId, chromeApi);
      await chromeApi.tabs.group({ tabIds: operation.tabIds, groupId });
      if (operation.expandTarget) await chromeApi.tabGroups.update(groupId, { collapsed: false });
      return;
    }
    case "ungroup_tabs":
      await chromeApi.tabs.ungroup(operation.tabIds);
      return;
    case "move_tabs":
      await chromeApi.tabs.move(operation.tabIds, { windowId: operation.windowId, index: operation.index });
      return;
    case "move_group":
      await chromeApi.tabGroups.move(operation.groupId, { windowId: operation.windowId, index: operation.index });
      return;
    default:
      throw new Error(`Unsupported operation: ${operation.type}`);
  }
}

async function moveTabsToWindow(tabIds, windowId, chromeApi) {
  const tabs = await Promise.all(tabIds.map((id) => chromeApi.tabs.get(id)));
  const outside = tabs.filter((tab) => tab.windowId !== windowId).map((tab) => tab.id);
  if (outside.length) await chromeApi.tabs.move(outside, { windowId, index: -1 });
}

async function restoreSnapshot(before, affectedTabIds, affectedGroupIds, chromeApi) {
  const beforeTabs = before.tabs.filter((tab) => affectedTabIds.includes(tab.id));
  const liveTabs = new Set((await chromeApi.tabs.query({})).map((tab) => tab.id));
  if (beforeTabs.some((tab) => !liveTabs.has(tab.id))) throw new Error("Cannot restore a tab that is no longer open.");

  for (const tab of [...beforeTabs].sort((a, b) => a.index - b.index)) {
    await chromeApi.tabs.move(tab.id, { windowId: tab.windowId, index: tab.index });
  }
  if (beforeTabs.length) await chromeApi.tabs.ungroup(beforeTabs.map((tab) => tab.id));

  const currentGroups = new Map((await chromeApi.tabGroups.query({})).map((group) => [group.id, group]));
  const groupsToRestore = before.groups.filter((group) =>
    affectedGroupIds.includes(group.id) || beforeTabs.some((tab) => tab.groupId === group.id),
  );

  for (const group of groupsToRestore) {
    const memberIds = beforeTabs.filter((tab) => tab.groupId === group.id).map((tab) => tab.id);
    let groupId = currentGroups.has(group.id) ? group.id : undefined;
    if (memberIds.length) {
      groupId = groupId === undefined
        ? await chromeApi.tabs.group({ tabIds: memberIds, createProperties: { windowId: group.windowId } })
        : await chromeApi.tabs.group({ tabIds: memberIds, groupId });
    }
    if (groupId !== undefined) {
      await chromeApi.tabGroups.update(groupId, { title: group.title, color: group.color, collapsed: group.collapsed });
    }
  }

  for (const tab of [...beforeTabs].sort((a, b) => a.index - b.index)) {
    await chromeApi.tabs.move(tab.id, { windowId: tab.windowId, index: tab.index });
  }
  for (const tab of beforeTabs.filter((candidate) => candidate.active)) {
    await chromeApi.tabs.update(tab.id, { active: true });
  }
}

function tabRecord(tab) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    index: tab.index,
    title: tab.title ?? "",
    url: tab.url ?? tab.pendingUrl ?? "",
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    discarded: Boolean(tab.discarded),
    groupId: tab.groupId,
  };
}

function groupRecord(group) {
  return {
    id: group.id,
    windowId: group.windowId,
    title: group.title ?? "",
    color: group.color,
    collapsed: Boolean(group.collapsed),
    shared: Boolean(group.shared),
  };
}

function pick(value, keys) {
  return Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));
}

function stale(message) {
  const error = new Error(`Stale grouping plan: ${message} Refresh the tab inventory and preview again.`);
  error.code = "STALE_PLAN";
  return error;
}
