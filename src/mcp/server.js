import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GROUP_COLORS } from "../core/plan.js";

const tabRefs = z.array(z.string()).min(1).describe("Opaque tab references from one snapshot.");
const operationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_group"),
    group_key: z.string().min(1),
    window_ref: z.string(),
    title: z.string().max(128),
    color: z.enum(GROUP_COLORS).optional(),
    collapsed: z.boolean().optional(),
    tab_refs: tabRefs,
  }),
  z.object({
    type: z.literal("update_group"),
    group_ref: z.string(),
    title: z.string().max(128).optional(),
    color: z.enum(GROUP_COLORS).optional(),
    collapsed: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("assign_tabs"),
    group_ref: z.string().optional(),
    group_key: z.string().optional(),
    tab_refs: tabRefs,
  }),
  z.object({ type: z.literal("ungroup_tabs"), tab_refs: tabRefs }),
  z.object({
    type: z.literal("move_tabs"),
    tab_refs: tabRefs,
    window_ref: z.string(),
    index: z.number().int().min(-1).optional(),
  }),
  z.object({
    type: z.literal("move_group"),
    group_ref: z.string(),
    window_ref: z.string(),
    index: z.number().int().min(-1).optional(),
  }),
]);

export function createMcpServer(service) {
  const server = new McpServer({ name: "chrome-tab-grouping", version: "0.1.2" });

  server.registerTool("list_chrome_profiles", {
    title: "List connected Chrome profiles",
    description: "List Chrome profile instances connected through the companion extension, briefly waiting for a sleeping companion to reconnect.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => call(() => service.listProfiles()));

  server.registerTool("list_chrome_tabs", {
    title: "List Chrome tabs",
    description: "Create or page through a profile-scoped tab snapshot. Start with summary, then fetch only the tabs needed for semantic grouping.",
    inputSchema: {
      profile_id: z.string().optional(),
      snapshot_id: z.string().optional(),
      scope: z.enum(["summary", "ungrouped", "all", "window", "group"]).optional(),
      window_ref: z.string().optional(),
      group_ref: z.string().optional(),
      cursor: z.union([z.string(), z.number().int().nonnegative()]).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, (input) => call(() => service.listTabs(input)));

  server.registerTool("preview_tab_grouping", {
    title: "Preview a Chrome tab grouping plan",
    description: "Validate and summarize a structured grouping plan without changing Chrome. Every mutation must pass through this tool first.",
    inputSchema: {
      snapshot_id: z.string(),
      operations: z.array(operationSchema).min(1),
      allow_cross_window: z.boolean().optional(),
      keep_active_visible: z.boolean().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, (input) => call(() => service.preview(input)));

  server.registerTool("apply_tab_grouping", {
    title: "Apply a previewed Chrome tab grouping plan",
    description: "Revalidate and apply a short-lived previewed plan. automatic_sweep is accepted only for ungrouped tabs added to existing groups.",
    inputSchema: {
      plan_id: z.string(),
      authorization: z.enum(["automatic_sweep", "preapproved", "confirmed"]),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, (input) => call(() => service.apply(input)));

  server.registerTool("undo_last_tab_grouping", {
    title: "Undo the most recent Chrome tab grouping",
    description: "Restore the previous grouping state when no conflicting Chrome changes have occurred since the apply.",
    inputSchema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, () => call(() => service.undo()));

  return server;
}

async function call(operation) {
  try {
    const value = await operation();
    return {
      content: [{ type: "text", text: JSON.stringify(value) }],
      structuredContent: value,
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: error.message || "Chrome tab grouping failed." }],
    };
  }
}
