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

Load the same unpacked extension in another Chrome profile to make that profile available. The manifest contains a fixed key, so it receives the same extension ID on both platforms and profiles. When multiple profiles are connected, the configured default is selected; otherwise the model asks which profile to use.

Platform-specific setup commands are also available as `npm run setup:mac` and `npm run setup:windows`.

## Development updates

After changing the plugin, extension, or native bridge, run:

```bash
npm run plugin:refresh
```

The refresh command rebuilds the bundle with a fresh Codex cache key and reinstalls it from `.dev-marketplace`. On Windows it also refreshes the native host and the extension copy under `%LOCALAPPDATA%`. A full app restart is not required; start a new task so it receives the refreshed skill and MCP tool catalog. Reload the unpacked extension in `chrome://extensions` only when files under `extension/` changed.

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

The integration test covers listing, compact planning, applying, stale-tab rejection, structural-change authorization, shared-group protection, and one-step undo with an in-memory Chrome implementation.

## Local protocol

The Codex-launched MCP process owns a user-only Unix socket on macOS or a local named pipe on Windows. Chrome starts the registered native messaging shim, which forwards JSON messages between that endpoint and the extension service worker. The extension alone calls `chrome.tabs`, `chrome.windows`, and `chrome.tabGroups`.

On Windows, setup compiles a small .NET launcher into an `.exe` because Chrome requires a native-host executable. The launcher contains no tab logic; it starts the bundled Node entrypoint with Chrome's standard input and output handles intact. Chrome discovers its manifest through `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.openai.chrome_tab_grouping`.
