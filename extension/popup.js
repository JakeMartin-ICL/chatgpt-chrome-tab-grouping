const statusElement = document.querySelector("#status");
const reconnectButton = document.querySelector("#reconnect");

function renderStatus(result = {}) {
  const state = ["connected", "connecting", "disconnected"].includes(result.status)
    ? result.status
    : "disconnected";
  statusElement.dataset.state = state;
  statusElement.textContent = state === "connected"
    ? "Connected to Codex"
    : state === "connecting"
      ? "Connecting to Codex…"
      : "Codex is not currently connected";
}

async function requestStatus(type) {
  try {
    renderStatus(await chrome.runtime.sendMessage({ type }));
  } catch {
    renderStatus({ status: "disconnected" });
  }
}

reconnectButton.addEventListener("click", async () => {
  reconnectButton.disabled = true;
  renderStatus({ status: "connecting" });
  await requestStatus("reconnect_now");
  reconnectButton.disabled = false;
});

void requestStatus("connection_status");
