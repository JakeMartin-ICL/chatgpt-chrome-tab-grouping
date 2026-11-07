import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyGroupingPlan, getInventory, undoGrouping } from "../extension/operations.js";
import { UndoStore } from "../src/core/state-store.js";
import { TabGroupingService } from "../src/mcp/service.js";
import { FakeChrome, exampleChromeState } from "./helpers/fake-chrome.js";

class FakeBroker {
  constructor(chrome) {
    this.chrome = chrome;
  }

  listProfiles() {
    return [{ profile_id: "profile-personal", label: "Personal", is_default: true, connected_at: new Date(0).toISOString() }];
  }

  async request(profileId, action, payload) {
    assert.equal(profileId, "profile-personal");
    if (action === "inventory") return await getInventory(this.chrome);
    if (action === "apply_plan") return await applyGroupingPlan(payload, this.chrome);
    if (action === "undo") return await undoGrouping(payload, this.chrome);
    throw new Error(`Unexpected action ${action}`);
  }
}

async function setup() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "chrome-tab-grouping-test-"));
  const chrome = new FakeChrome(exampleChromeState());
  const service = new TabGroupingService({
    broker: new FakeBroker(chrome),
    undoStore: new UndoStore(path.join(temp, "undo.json")),
  });
  return { chrome, service };
}

test("lists, previews, applies an automatic sweep, and undoes it", async () => {
  const { chrome, service } = await setup();
  const listing = await service.listTabs({ scope: "ungrouped", limit: 1 });
  assert.equal(listing.totals.tabs, 3);
  assert.equal(listing.tabs.length, 1);
  assert.ok(listing.next_cursor);

  const target = listing.groups.find((group) => group.title === "Aries Development");
  const plan = service.preview({
    snapshot_id: listing.snapshot_id,
    operations: [{ type: "assign_tabs", group_ref: target.ref, tab_refs: [listing.tabs[0].ref] }],
  });
  assert.equal(plan.automatic_sweep, true);
  assert.equal(plan.requires_confirmation, false);

  const applied = await service.apply({ plan_id: plan.plan_id, authorization: "automatic_sweep" });
  assert.equal(applied.applied, true);
  assert.equal(chrome.state.tabs.find((tab) => tab.id === 102).groupId, 10);

  const undone = await service.undo();
  assert.equal(undone.undone, true);
  assert.equal(chrome.state.tabs.find((tab) => tab.id === 102).groupId, -1);
});

test("rejects a stale plan before mutating any tab", async () => {
  const { chrome, service } = await setup();
  const listing = await service.listTabs({ scope: "ungrouped" });
  const target = listing.groups[0];
  const plan = service.preview({
    snapshot_id: listing.snapshot_id,
    operations: [{ type: "assign_tabs", group_ref: target.ref, tab_refs: [listing.tabs[0].ref] }],
  });

  chrome.state.tabs.find((tab) => tab.id === 102).url = "https://example.test/different";
  await assert.rejects(
    service.apply({ plan_id: plan.plan_id, authorization: "automatic_sweep" }),
    /Stale grouping plan/,
  );
  assert.equal(chrome.state.tabs.find((tab) => tab.id === 102).groupId, -1);
});

test("requires preapproval or confirmation for structural changes", async () => {
  const { chrome, service } = await setup();
  const listing = await service.listTabs({ scope: "ungrouped" });
  const windowRef = listing.windows[0].ref;
  const researchTab = listing.tabs.find((tab) => tab.title === "Research");
  const plan = service.preview({
    snapshot_id: listing.snapshot_id,
    operations: [{
      type: "create_group",
      group_key: "research",
      window_ref: windowRef,
      title: "Reference",
      color: "purple",
      collapsed: true,
      tab_refs: [researchTab.ref],
    }],
  });
  assert.equal(plan.requires_confirmation, true);
  await assert.rejects(
    service.apply({ plan_id: plan.plan_id, authorization: "automatic_sweep" }),
    /cannot be auto-applied/,
  );

  await service.apply({ plan_id: plan.plan_id, authorization: "preapproved" });
  const created = chrome.state.groups.find((group) => group.title === "Reference");
  assert.ok(created);
  assert.equal(created.collapsed, true);
});

test("protects shared groups and cross-window moves during preview", async () => {
  const { chrome, service } = await setup();
  chrome.state.groups[0].shared = true;
  const listing = await service.listTabs({ scope: "ungrouped" });
  await assert.rejects(
    async () => service.preview({
      snapshot_id: listing.snapshot_id,
      operations: [{ type: "assign_tabs", group_ref: listing.groups[0].ref, tab_refs: [listing.tabs[0].ref] }],
    }),
    /Shared group/,
  );
});

test("profile listing briefly waits for a sleeping companion to reconnect", async () => {
  const connectedProfile = {
    profile_id: "profile-delayed",
    label: "Delayed",
    is_default: false,
    connected_at: new Date(0).toISOString(),
  };
  let waited = false;
  const service = new TabGroupingService({
    broker: {
      listProfiles() { return []; },
      async waitForProfiles(timeoutMs) {
        assert.equal(timeoutMs, 5_000);
        waited = true;
        return [connectedProfile];
      },
    },
  });

  const result = await service.listProfiles();
  assert.equal(waited, true);
  assert.deepEqual(result.profiles, [connectedProfile]);
  assert.equal(result.connected_count, 1);
});
