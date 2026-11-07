# Chrome Tab Grouping

A personal Codex plugin for macOS and Windows that lets the desktop app inspect and organize Chrome tab groups. Semantic decisions stay with the model; a local Manifest V3 extension validates and executes structured plans through supported Chrome APIs.

The companion never closes tabs, does not read page contents, does not run in incognito, and cannot move tabs between Chrome profiles.

## Requirements

- macOS or Windows 11
- Google Chrome 120 or newer
- Node.js 22 or newer
- The Codex/ChatGPT desktop app with personal plugins enabled
- The `codex` command available on `PATH` for local marketplace installation

## Development setup

1. Run the one-time setup from the repository root:

   ```bash
   npm run setup
   ```

   This installs dependencies, registers the native bridge, builds a self-contained plugin bundle, registers the generated repository-local marketplace, and installs the plugin. It does not copy the repository or edit the personal marketplace JSON. On Windows, setup uses the current user's registry hive and does not require administrator access.

2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**:

   - macOS: select the repository's `extension` directory.
   - Windows: select `%LOCALAPPDATA%\ChromeTabGrouping\extension`. Setup prints the resolved path.

3. Open the extension's **Details → Extension options** and name the Chrome profile, for example `Personal` or `Work`.

4. Start a new task and try: `Sweep my ungrouped tabs into existing groups.`

The extension's toolbar popup shows whether it is connected to the current Codex task. Opening the popup wakes Chrome's service worker; choose **Reconnect now** to retry immediately when it shows as disconnected.

Load the same unpacked extension in another Chrome profile to make that profile available. The manifest contains a fixed key, so it receives the same extension ID on both platforms and profiles. When multiple profiles are connected, the configured default is selected; otherwise the model asks which profile to use.

Platform-specific setup commands are also available as `npm run setup:mac` and `npm run setup:windows`.

## Development updates

After changing the plugin, extension, or native bridge, run:

```bash
npm run plugin:refresh
```

The refresh command stops the shared bridge, rebuilds the bundle with a fresh Codex cache key, and reinstalls it from `.dev-marketplace`. On Windows it also refreshes the native host and the extension copy under `%LOCALAPPDATA%`. A full app restart is not normally required; start a new task so it receives the refreshed skill and MCP tool catalog. Reload the unpacked extension in `chrome://extensions` when files under `extension/` changed or when upgrading from the older per-task bridge.

## Removal

Run:

```bash
npm run teardown
```

Then remove **Chrome Tab Grouping Companion** from `chrome://extensions` in every profile. On Windows, teardown removes the per-user native-messaging registry entry and `%LOCALAPPDATA%\ChromeTabGrouping`. The generated `.dev-marketplace` directory is disposable and ignored by Git.

## Tool workflow

The plugin exposes tools to:

- list connected Chrome profiles;
- snapshot and page through tabs, windows, and existing groups;
- preview a grouping plan without changing Chrome;
- apply a short-lived plan after a second stale-state validation;
- undo the latest successful operation when no conflicting browser changes occurred.

Every mutation requires a previewed `plan_id`. Adding ungrouped tabs to existing groups can be applied as an automatic sweep; structural changes require prompt pre-approval or confirmation. Cross-window changes must be explicitly requested.

## Testing

```bash
npm test
npm run check
```

The tests cover listing, compact planning, applying, stale-tab rejection, structural-change authorization, shared-group protection, one-step undo, delayed bridge startup, singleton ownership across multiple MCP clients, and the extension's reconnect popup.

## Connection recovery

Chrome normally suspends an idle Manifest V3 service worker. The companion reconnects when Chrome wakes it and keeps it alive while its native-messaging port is active. When Codex starts while the worker is asleep, profile discovery waits briefly for that reconnect instead of failing immediately. While disconnected, a repeating Chrome alarm provides a 30-second fallback; it is removed as soon as the broker acknowledges the connection.

For an immediate retry, click **Chrome Tab Grouping Companion** in Chrome's toolbar and choose **Reconnect now**. This wakes the worker and waits for a broker acknowledgement. The small per-user daemon remains available between Codex tasks and is stopped by setup, refresh, or teardown when its lifecycle needs to change.

## Local protocol

The first Codex task that needs Chrome lazily starts one shared, per-user bridge daemon. That daemon owns a user-only Unix socket on macOS or local named pipes on Windows. Each task's MCP process connects to the shared daemon as a client, so starting or closing another task cannot steal the Chrome profile connection. Chrome starts the registered native messaging shim, which forwards JSON messages between the daemon and the extension service worker. The extension alone calls `chrome.tabs`, `chrome.windows`, and `chrome.tabGroups`.

On Windows, setup compiles a small .NET launcher into an `.exe` because Chrome requires a native-host executable. The launcher contains no tab logic; it starts the bundled Node entrypoint with Chrome's standard input and output handles intact. Chrome discovers its manifest through `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.openai.chrome_tab_grouping`.
