export class FakeChrome {
  constructor({ windows, tabs, groups }) {
    this.state = {
      windows: structuredClone(windows),
      tabs: structuredClone(tabs),
      groups: structuredClone(groups),
    };
    this.nextGroupId = Math.max(0, ...groups.map((group) => group.id)) + 1;
    this.windows = {
      getAll: async () => structuredClone(this.state.windows),
    };
    this.tabs = {
      query: async () => structuredClone(this.state.tabs),
      get: async (id) => structuredClone(this.#tab(id)),
      group: async ({ tabIds, groupId, createProperties }) => {
        const ids = asArray(tabIds);
        if (groupId === undefined) {
          groupId = this.nextGroupId++;
          this.state.groups.push({ id: groupId, windowId: createProperties.windowId, title: "", color: "grey", collapsed: false, shared: false });
        }
        const group = this.#group(groupId);
        for (const id of ids) {
          const tab = this.#tab(id);
          tab.windowId = group.windowId;
          tab.groupId = groupId;
        }
        this.#removeEmptyGroups();
        return groupId;
      },
      ungroup: async (tabIds) => {
        for (const id of asArray(tabIds)) this.#tab(id).groupId = -1;
        this.#removeEmptyGroups();
      },
      move: async (tabIds, { windowId, index }) => {
        const moved = [];
        for (const [offset, id] of asArray(tabIds).entries()) {
          const tab = this.#tab(id);
          if (windowId !== undefined && windowId !== tab.windowId) {
            tab.windowId = windowId;
            tab.groupId = -1;
          }
          tab.index = index === -1 ? 999 + offset : index + offset;
          moved.push(structuredClone(tab));
        }
        this.#removeEmptyGroups();
        return moved.length === 1 ? moved[0] : moved;
      },
      update: async (id, changes) => {
        const tab = this.#tab(id);
        if (changes.active) {
          for (const candidate of this.state.tabs.filter((item) => item.windowId === tab.windowId)) candidate.active = false;
        }
        Object.assign(tab, changes);
        return structuredClone(tab);
      },
    };
    this.tabGroups = {
      query: async () => structuredClone(this.state.groups),
      get: async (id) => structuredClone(this.#group(id)),
      update: async (id, changes) => {
        const group = this.#group(id);
        Object.assign(group, changes);
        return structuredClone(group);
      },
      move: async (id, { windowId }) => {
        const group = this.#group(id);
        if (windowId !== undefined) {
          group.windowId = windowId;
          for (const tab of this.state.tabs.filter((item) => item.groupId === id)) tab.windowId = windowId;
        }
        return structuredClone(group);
      },
    };
  }

  #tab(id) {
    const tab = this.state.tabs.find((candidate) => candidate.id === id);
    if (!tab) throw new Error(`No tab with id ${id}`);
    return tab;
  }

  #group(id) {
    const group = this.state.groups.find((candidate) => candidate.id === id);
    if (!group) throw new Error(`No group with id ${id}`);
    return group;
  }

  #removeEmptyGroups() {
    this.state.groups = this.state.groups.filter((group) => this.state.tabs.some((tab) => tab.groupId === group.id));
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

export function exampleChromeState() {
  return {
    windows: [{ id: 1, focused: true, type: "normal" }],
    groups: [{ id: 10, windowId: 1, title: "Aries Development", color: "blue", collapsed: false, shared: false }],
    tabs: [
      { id: 101, windowId: 1, index: 0, title: "Aries app", url: "https://localhost.test/aries", active: true, pinned: false, discarded: false, groupId: 10 },
      { id: 102, windowId: 1, index: 1, title: "Aries issue", url: "https://example.test/issue", active: false, pinned: false, discarded: false, groupId: -1 },
      { id: 103, windowId: 1, index: 2, title: "Research", url: "https://example.test/research", active: false, pinned: false, discarded: true, groupId: -1 },
    ],
  };
}
