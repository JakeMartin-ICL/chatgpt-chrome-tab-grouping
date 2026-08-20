const input = document.querySelector("#profile-label");
const defaultInput = document.querySelector("#profile-default");
const status = document.querySelector("#status");

chrome.storage.local.get(["profileLabel", "profileDefault"]).then(({ profileLabel, profileDefault }) => {
  input.value = profileLabel || "Chrome profile";
  defaultInput.checked = Boolean(profileDefault);
});

document.querySelector("#save").addEventListener("click", async () => {
  const profileLabel = input.value.trim() || "Chrome profile";
  await chrome.storage.local.set({ profileLabel, profileDefault: defaultInput.checked });
  status.textContent = "Saved";
  setTimeout(() => { status.textContent = ""; }, 1500);
});
