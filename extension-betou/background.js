chrome.runtime.onInstalled.addListener(() => {
    console.log("[MEGATRON WS] instalado");
});

chrome.runtime.onMessage.addListener((msg) => {

    if (msg.type === "AVIATOR_DATA") {

        console.log("🎯 AVIATOR:", msg.data);

    }

});
