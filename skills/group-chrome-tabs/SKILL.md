---
name: group-chrome-tabs
description: Inspect, semantically organize, update, and undo Chrome tab groups through the local Chrome Tab Grouping MCP tools, including collecting likely disposable tabs into a review group. Use when the user asks to list, tidy, sweep, clean up, group, regroup, rename, recolor, collapse, move, ungroup, or identify tabs that can probably be closed.
---

# Group Chrome Tabs

Use the Chrome Tab Grouping tools for browser state. Perform semantic classification yourself; never infer that the local executor classifies tabs.

## Workflow

1. Call `list_chrome_profiles`. If exactly one profile is connected, use it. With multiple profiles, use the saved default or ask which profile unless the user explicitly requested all profiles.
2. Call `list_chrome_tabs` in `summary` scope first. For routine sweeps, page through `ungrouped`; otherwise request the minimum necessary group, window, or full inventory. Continue with the returned snapshot ID so references stay consistent.
3. During organization or cleanup, also consider the closing-suggestion policy below. Construct a plan from opaque tab, group, and window references. Preserve unspecified tabs and groups. Never close tabs. Never move between profiles. Only include cross-window moves when explicitly requested.
4. Call `preview_tab_grouping` for every mutation. Treat its validation as mandatory even when confirmation is not.
5. Apply immediately only when one of these is true:
   - the plan exclusively adds previously ungrouped tabs to existing non-shared groups;
   - the user explicitly pre-approved execution in the current request;
   - the user confirmed the displayed preview.
6. Otherwise show a compact preview containing group names, tab counts, and warnings—not every tab—and ask for confirmation.
7. Call `apply_tab_grouping` with the matching authorization mode. Report concise results and mention that one-step undo is available.

## Group names

Prefer short, readily distinguishable group names so more groups remain visible on the tab strip. Aim for about 12 characters or fewer when a clear name fits, but treat this as a soft target rather than a limit. Use a longer name whenever shortening it would make the group meaningfully less clear, ambiguous, or awkward.

## Closing suggestions

Collect likely disposable tabs into a red, collapsed group named `Closing Suggestions`; never close them. Reuse that group when it already exists. Exclude active and pinned tabs, and avoid moving already-organized tabs unless the evidence is especially strong or the user requested aggressive cleanup.

Use a conservative threshold by default. Include only tabs whose title and URL together make their one-shot purpose nearly certain, such as completed or failed OAuth callbacks, explicit “authentication complete” or “you may close this window” pages, expired/cancelled authorization handoffs, and similarly terminal workflow pages. A callback-looking URL alone is insufficient when the title looks like a normal application page.

When the user asks for aggressive cleanup, also include plausible clutter for review: redundant exact duplicates while preserving one copy, explicit 404/410 or connection-error pages, expired-link pages, inactive blank tabs, completed transient confirmation pages, and other obviously one-purpose handoffs. Treat these as suggestions rather than claims that closing is safe.

Do not infer staleness from age when age metadata is unavailable. Do not expose OAuth codes, state values, tokens, or URL query/fragment contents in the preview; summarize candidates by reason and count. If classification is uncertain even under the requested threshold, leave the tab where it is.

## Safety

- Keep the active tab active, in its window, and outside collapsed groups when practical.
- Do not touch incognito tabs or shared groups unless the tool explicitly supports an opted-in shared-group plan.
- Refuse to reinterpret missing or stale references. Refresh the inventory and rebuild the plan.
- Do not treat similar titles or URLs as authorization to substitute one tab for another.
- Do not move tabs between Chrome windows without an explicit request.
- If undo reports a conflict, explain that later browser activity was preserved and do not retry destructively.

## Preview style

Prefer one line per created or updated group, for example `Aries Development — +18 tabs`. Add totals for unchanged groups and remaining ungrouped tabs. Expand individual tabs only when the user asks or a warning needs inspection.
