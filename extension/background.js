chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("keepAlive", { periodInMinutes: 1 });
  console.log("[BG] Extensão Sortenabet iniciada");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepAlive") {
    console.log("[BG] Alive");
  }
});

setInterval(() => {
  fetch("https://painel-aviator.onrender.com/status").catch(() => {});
}, 4 * 60 * 1000);