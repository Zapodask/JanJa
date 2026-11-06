let electron = require("electron");
// src/preload/index.ts
function subscribe(channel, cb) {
	const listener = (_, payload) => cb(payload);
	electron.ipcRenderer.on(channel, listener);
	return () => electron.ipcRenderer.removeListener(channel, listener);
}
var api = {
	platform: process.platform,
	listSources: () => electron.ipcRenderer.invoke("capture:list"),
	selectSource: (id, withAudio) => electron.ipcRenderer.invoke("capture:select", {
		id,
		withAudio
	}),
	createRoom: (opts) => electron.ipcRenderer.invoke("room:create", opts),
	closeRoom: () => electron.ipcRenderer.invoke("room:close"),
	onRoomStatus: (cb) => subscribe("room:status", cb),
	onJoinRequest: (cb) => subscribe("room:join-request", cb),
	respondJoin: (requestId, approved) => electron.ipcRenderer.send("room:join-response", {
		requestId,
		approved
	})
};
electron.contextBridge.exposeInMainWorld("janja", api);
