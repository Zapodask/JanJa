let node_path = require("node:path");
let electron = require("electron");
let node_crypto = require("node:crypto");
let zod = require("zod");
let node_os = require("node:os");
let node_http = require("node:http");
let ws = require("ws");
let node_child_process = require("node:child_process");
let node_fs = require("node:fs");
let cloudflared = require("cloudflared");
// src/main/capture.ts
/**
* O renderer escolhe a fonte no seletor do próprio JanJa (`capture:select`) e depois chama
* getDisplayMedia; este handler entrega a fonte escolhida. No Windows o áudio do sistema
* vem por loopback.
*/
var selected = null;
function registerCapture() {
	electron.ipcMain.handle("capture:list", async () => {
		return (await electron.desktopCapturer.getSources({
			types: ["screen", "window"],
			thumbnailSize: {
				width: 320,
				height: 180
			},
			fetchWindowIcons: false
		})).filter((s) => !s.name.startsWith("JanJa")).map((s) => ({
			id: s.id,
			name: s.name,
			kind: s.id.startsWith("screen:") ? "screen" : "window",
			thumbnail: s.thumbnail.toDataURL()
		}));
	});
	electron.ipcMain.handle("capture:select", (_e, sel) => {
		selected = {
			id: String(sel.id),
			withAudio: !!sel.withAudio
		};
	});
	electron.session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
		const choice = selected;
		selected = null;
		if (!choice) return callback({});
		const source = (await electron.desktopCapturer.getSources({ types: ["screen", "window"] })).find((s) => s.id === choice.id);
		if (!source) return callback({});
		callback({
			video: source,
			...choice.withAudio && process.platform === "win32" ? { audio: "loopback" } : {}
		});
	});
}
// src/shared/protocol.ts
/** Protocolo de sinalização do JanJa. O servidor só repassa `signal` entre peers, sem ler o SDP. */
var MAX_MESSAGE_BYTES = 65536;
var IceServerSchema = zod.z.object({
	urls: zod.z.union([zod.z.string(), zod.z.array(zod.z.string())]),
	username: zod.z.string().optional(),
	credential: zod.z.string().optional()
});
var PeerStateSchema = zod.z.object({
	sharing: zod.z.boolean(),
	micMuted: zod.z.boolean(),
	/** id do MediaStream da tela, para o receptor separar áudio da tela do microfone */
	screenStreamId: zod.z.string().max(128).optional()
});
var SignalPayloadSchema = zod.z.object({
	description: zod.z.object({
		type: zod.z.enum([
			"offer",
			"answer",
			"pranswer",
			"rollback"
		]),
		sdp: zod.z.string().optional()
	}).optional(),
	candidate: zod.z.object({
		candidate: zod.z.string().optional(),
		sdpMid: zod.z.string().nullable().optional(),
		sdpMLineIndex: zod.z.number().nullable().optional(),
		usernameFragment: zod.z.string().nullable().optional()
	}).nullable().optional()
});
var ClientMessageSchema = zod.z.discriminatedUnion("type", [
	zod.z.object({
		type: zod.z.literal("join"),
		token: zod.z.string().min(1).max(128),
		name: zod.z.string().trim().min(1).max(32)
	}),
	zod.z.object({
		type: zod.z.literal("signal"),
		to: zod.z.string().min(1).max(64),
		payload: SignalPayloadSchema
	}),
	zod.z.object({
		type: zod.z.literal("state"),
		state: PeerStateSchema
	}),
	zod.z.object({ type: zod.z.literal("ping") })
]);
var PeerInfoSchema = zod.z.object({
	peerId: zod.z.string(),
	name: zod.z.string(),
	state: PeerStateSchema
});
var ErrorCodeSchema = zod.z.enum([
	"bad-token",
	"room-full",
	"denied",
	"bad-message",
	"not-joined",
	"rate-limited",
	"join-timeout",
	"unknown-peer"
]);
zod.z.discriminatedUnion("type", [
	zod.z.object({
		type: zod.z.literal("welcome"),
		peerId: zod.z.string(),
		peers: zod.z.array(PeerInfoSchema),
		iceServers: zod.z.array(IceServerSchema)
	}),
	zod.z.object({ type: zod.z.literal("waiting-approval") }),
	zod.z.object({
		type: zod.z.literal("peer-joined"),
		peer: PeerInfoSchema
	}),
	zod.z.object({
		type: zod.z.literal("peer-left"),
		peerId: zod.z.string()
	}),
	zod.z.object({
		type: zod.z.literal("signal"),
		from: zod.z.string(),
		payload: SignalPayloadSchema
	}),
	zod.z.object({
		type: zod.z.literal("state"),
		from: zod.z.string(),
		state: PeerStateSchema
	}),
	zod.z.object({ type: zod.z.literal("pong") }),
	zod.z.object({
		type: zod.z.literal("error"),
		code: ErrorCodeSchema,
		message: zod.z.string()
	})
]);
var INITIAL_STATE = {
	sharing: false,
	micMuted: false
};
/** Código da sala = URL do WebSocket + token no fragmento (#t=...), que não vai para logs de servidor. */
function buildRoomCode(wsUrl, token) {
	const url = new URL(wsUrl);
	url.hash = `t=${token}`;
	return url.toString();
}
// src/main/net.ts
/** IPv4 locais úteis para o modo LAN/Tailscale (Tailscale usa 100.64.0.0/10). */
function localAddresses() {
	const out = [];
	for (const [iface, list] of Object.entries((0, node_os.networkInterfaces)())) for (const info of list ?? []) {
		if (info.family !== "IPv4" || info.internal) continue;
		const [a, b] = info.address.split(".").map(Number);
		const tailscale = a === 100 && b >= 64 && b <= 127;
		out.push({
			address: info.address,
			iface,
			kind: tailscale ? "tailscale" : "lan"
		});
	}
	return out.sort((x, y) => x.kind === y.kind ? 0 : x.kind === "tailscale" ? -1 : 1);
}
// src/main/signaling/server.ts
/** Quem abre o link da sala no navegador cai aqui (o WebSocket usa o mesmo endereço). */
var LANDING_HTML = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Sala do JanJa</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;background:#14141a;color:#ececf1;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:520px;padding:24px}h1{color:#7c6cff;margin:0 0 8px}code{display:block;word-break:break-all;background:#1d1d25;border:1px solid #34343f;border-radius:8px;padding:10px;margin:12px 0}
button{background:#7c6cff;color:#fff;border:0;border-radius:8px;padding:10px 16px;font:inherit;cursor:pointer}ol{line-height:1.7}</style></head>
<body><main><h1>Você foi convidado para uma sala do JanJa</h1>
<p>Este link abre no app do JanJa, não no navegador.</p>
<ol><li>Abra o JanJa no seu PC.</li><li>Em <b>Entrar numa sala</b>, cole o link abaixo.</li><li>Clique em <b>Entrar</b>.</li></ol>
<code id="l"></code><button id="c">Copiar link</button></main>
<script>var l=document.getElementById('l');l.textContent=location.href;document.getElementById('c').onclick=function(){navigator.clipboard.writeText(location.href);this.textContent='Copiado!'}<\/script>
</body></html>`;
function newToken(bytes = 16) {
	return (0, node_crypto.randomBytes)(bytes).toString("base64url");
}
function safeEqual(a, b) {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	return ab.length === bb.length && (0, node_crypto.timingSafeEqual)(ab, bb);
}
var SignalingServer = class {
	wss;
	http;
	peers = /* @__PURE__ */ new Map();
	opts;
	constructor(options) {
		this.opts = {
			maxPeers: 5,
			joinTimeoutMs: 1e4,
			rateLimit: {
				windowMs: 1e4,
				max: 400
			},
			...options
		};
	}
	get peerCount() {
		return this.peers.size;
	}
	listPeers() {
		return [...this.peers.values()].map((p) => ({
			peerId: p.id,
			name: p.name,
			state: p.state
		}));
	}
	start() {
		return new Promise((resolve, reject) => {
			const http = (0, node_http.createServer)((_req, res) => {
				res.writeHead(200, {
					"content-type": "text/html; charset=utf-8",
					"cache-control": "no-store"
				});
				res.end(LANDING_HTML);
			});
			const wss = new ws.WebSocketServer({
				server: http,
				maxPayload: MAX_MESSAGE_BYTES
			});
			this.http = http;
			this.wss = wss;
			wss.on("error", (err) => console.error("[signaling]", err));
			wss.on("connection", (socket) => this.onConnection(socket));
			http.once("error", reject);
			http.listen(this.opts.port, this.opts.host, () => {
				http.off("error", reject);
				resolve(http.address().port);
			});
		});
	}
	async stop() {
		const wss = this.wss;
		const http = this.http;
		if (!wss || !http) return;
		this.wss = void 0;
		this.http = void 0;
		for (const client of wss.clients) client.close(1001, "room closed");
		this.peers.clear();
		await new Promise((resolve) => wss.close(() => resolve()));
		http.closeAllConnections();
		await new Promise((resolve) => http.close(() => resolve()));
	}
	send(socket, msg) {
		if (socket.readyState === ws.WebSocket.OPEN) socket.send(JSON.stringify(msg));
	}
	fail(socket, code, message, close = false) {
		this.send(socket, {
			type: "error",
			code,
			message
		});
		if (close) socket.close(4e3, code);
	}
	broadcast(msg, exceptId) {
		for (const peer of this.peers.values()) if (peer.id !== exceptId) this.send(peer.socket, msg);
	}
	onConnection(socket) {
		const conn = {
			joining: false,
			windowStart: Date.now(),
			count: 0
		};
		conn.joinTimer = setTimeout(() => {
			if (!conn.peerId && !conn.joining) this.fail(socket, "join-timeout", "Tempo para entrar esgotado.", true);
		}, this.opts.joinTimeoutMs);
		socket.on("message", (data, isBinary) => {
			if (isBinary) return this.fail(socket, "bad-message", "Mensagens binárias não são aceitas.");
			if (!this.allow(conn)) return this.fail(socket, "rate-limited", "Mensagens demais.", true);
			this.onMessage(socket, conn, data);
		});
		socket.on("close", () => {
			clearTimeout(conn.joinTimer);
			if (conn.peerId && this.peers.get(conn.peerId)?.socket === socket) {
				this.peers.delete(conn.peerId);
				this.broadcast({
					type: "peer-left",
					peerId: conn.peerId
				});
			}
		});
		socket.on("error", () => socket.terminate());
	}
	allow(conn) {
		const now = Date.now();
		if (now - conn.windowStart > this.opts.rateLimit.windowMs) {
			conn.windowStart = now;
			conn.count = 0;
		}
		conn.count += 1;
		return conn.count <= this.opts.rateLimit.max;
	}
	async onMessage(socket, conn, data) {
		let raw;
		try {
			raw = JSON.parse(data.toString());
		} catch {
			return this.fail(socket, "bad-message", "JSON inválido.");
		}
		const parsed = ClientMessageSchema.safeParse(raw);
		if (!parsed.success) return this.fail(socket, "bad-message", "Mensagem fora do protocolo.");
		const msg = parsed.data;
		if (msg.type === "ping") return this.send(socket, { type: "pong" });
		if (msg.type === "join") {
			if (conn.peerId || conn.joining) return;
			const isHost = !!this.opts.hostToken && safeEqual(msg.token, this.opts.hostToken);
			if (!isHost && !safeEqual(msg.token, this.opts.token)) return this.fail(socket, "bad-token", "Token de sala inválido.", true);
			if (this.peers.size >= this.opts.maxPeers) return this.fail(socket, "room-full", `A sala está cheia (máx. ${this.opts.maxPeers}).`, true);
			if (!isHost && this.opts.onJoinRequest) {
				conn.joining = true;
				clearTimeout(conn.joinTimer);
				this.send(socket, { type: "waiting-approval" });
				let approved = false;
				try {
					approved = await this.opts.onJoinRequest(msg.name);
				} catch {
					approved = false;
				}
				conn.joining = false;
				if (socket.readyState !== ws.WebSocket.OPEN) return;
				if (!approved) return this.fail(socket, "denied", "O host recusou a entrada.", true);
				if (this.peers.size >= this.opts.maxPeers) return this.fail(socket, "room-full", `A sala está cheia (máx. ${this.opts.maxPeers}).`, true);
			}
			clearTimeout(conn.joinTimer);
			const peer = {
				id: newToken(8),
				name: msg.name,
				state: { ...INITIAL_STATE },
				socket
			};
			const existing = this.listPeers();
			this.peers.set(peer.id, peer);
			conn.peerId = peer.id;
			this.send(socket, {
				type: "welcome",
				peerId: peer.id,
				peers: existing,
				iceServers: this.opts.iceServers
			});
			this.broadcast({
				type: "peer-joined",
				peer: {
					peerId: peer.id,
					name: peer.name,
					state: peer.state
				}
			}, peer.id);
			return;
		}
		const me = conn.peerId ? this.peers.get(conn.peerId) : void 0;
		if (!me) return this.fail(socket, "not-joined", "Entre na sala antes.");
		if (msg.type === "signal") {
			const target = this.peers.get(msg.to);
			if (!target) return this.fail(socket, "unknown-peer", "Peer não encontrado.");
			return this.send(target.socket, {
				type: "signal",
				from: me.id,
				payload: msg.payload
			});
		}
		if (msg.type === "state") {
			me.state = msg.state;
			this.broadcast({
				type: "state",
				from: me.id,
				state: msg.state
			}, me.id);
		}
	}
};
// src/main/tunnel/cloudflared.ts
var TUNNEL_URL_RE = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/i;
var TUNNEL_FAILED_RE = /failed to request quick Tunnel[^\n]*/i;
/** Lê a saída acumulada do cloudflared: o link da sala, um erro, ou nada ainda. */
function parseTunnelOutput(log) {
	const failed = TUNNEL_FAILED_RE.exec(log);
	if (failed) return { error: failed[0] };
	const match = TUNNEL_URL_RE.exec(log);
	return match ? { url: match[0] } : null;
}
/**
* Garante o binário do cloudflared em `binDir` (baixa do GitHub da Cloudflare na primeira vez).
* Fica fora do asar para poder ser executado.
*/
async function ensureCloudflared(binDir, onStatus) {
	const exe = (0, node_path.join)(binDir, process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
	if ((0, node_fs.existsSync)(exe)) return exe;
	(0, node_fs.mkdirSync)((0, node_path.dirname)(exe), { recursive: true });
	onStatus?.("Baixando o cloudflared (só na primeira vez)...");
	await (0, cloudflared.install)(exe);
	return exe;
}
/** Sobe um Cloudflare Quick Tunnel (sem conta) apontando para o servidor local. */
function startQuickTunnel(exe, localPort, timeoutMs = 3e4) {
	return new Promise((resolve, reject) => {
		const child = (0, node_child_process.spawn)(exe, [
			"tunnel",
			"--no-autoupdate",
			"--url",
			`http://127.0.0.1:${localPort}`
		], {
			windowsHide: true,
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			]
		});
		let settled = false;
		let log = "";
		const stop = () => {
			if (child.exitCode === null && !child.killed) child.kill();
		};
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			stop();
			reject(/* @__PURE__ */ new Error(`O túnel não respondeu em ${timeoutMs / 1e3}s.\n${log.slice(-800)}`));
		}, timeoutMs);
		const onData = (chunk) => {
			log += chunk.toString();
			if (settled) return;
			const result = parseTunnelOutput(log);
			if (!result) return;
			settled = true;
			clearTimeout(timer);
			if ("url" in result) return resolve({
				url: result.url,
				stop
			});
			stop();
			reject(/* @__PURE__ */ new Error(`A Cloudflare não criou o túnel. Confira a internet ou use o modo Rede local/Tailscale.\n${result.error}`));
		};
		child.stdout?.on("data", onData);
		child.stderr?.on("data", onData);
		child.once("error", (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(err);
		});
		child.once("exit", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(/* @__PURE__ */ new Error(`cloudflared saiu com código ${code}.\n${log.slice(-800)}`));
		});
	});
}
// src/main/room.ts
var DEFAULT_ICE = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
var DEFAULT_LAN_PORT = 47800;
var APPROVAL_TIMEOUT_MS = 6e4;
/** Uma sala por vez: servidor de sinalização + (opcional) túnel. */
var RoomManager = class {
	hooks;
	server;
	tunnel;
	pending = /* @__PURE__ */ new Map();
	constructor(hooks) {
		this.hooks = hooks;
	}
	get isOpen() {
		return !!this.server;
	}
	async create(opts) {
		await this.close();
		const iceServers = [...DEFAULT_ICE, ...opts.iceServers.filter((s) => IceServerSchema.safeParse(s).success)];
		const token = newToken();
		const hostToken = newToken();
		const lan = opts.mode === "lan";
		const server = new SignalingServer({
			host: lan ? "0.0.0.0" : "127.0.0.1",
			port: lan ? opts.lanPort ?? DEFAULT_LAN_PORT : 0,
			token,
			hostToken,
			iceServers,
			onJoinRequest: opts.requireApproval ? (name) => this.requestApproval(name) : void 0
		});
		this.hooks.status("Iniciando o servidor da sala...");
		const port = await server.start();
		this.server = server;
		const hostCode = buildRoomCode(`ws://127.0.0.1:${port}/`, hostToken);
		try {
			if (lan) {
				const codes = localAddresses().map((a) => ({
					label: `${a.kind === "tailscale" ? "Tailscale" : "Rede local"} (${a.iface})`,
					code: buildRoomCode(`http://${a.address}:${port}/`, token)
				}));
				this.hooks.status("Sala aberta na rede local.");
				return {
					mode: "lan",
					codes,
					hostCode
				};
			}
			const exe = await ensureCloudflared(this.hooks.binDir, this.hooks.status);
			this.hooks.status("Abrindo o túnel da Cloudflare...");
			this.tunnel = await startQuickTunnel(exe, port);
			this.hooks.status("Sala aberta.");
			return {
				mode: "tunnel",
				codes: [{
					label: "Link da sala",
					code: buildRoomCode(`${this.tunnel.url}/`, token)
				}],
				hostCode
			};
		} catch (err) {
			await this.close();
			throw err;
		}
	}
	async close() {
		for (const resolve of this.pending.values()) resolve(false);
		this.pending.clear();
		this.tunnel?.stop();
		this.tunnel = void 0;
		const server = this.server;
		this.server = void 0;
		await server?.stop();
	}
	respond(requestId, approved) {
		this.pending.get(requestId)?.(approved);
	}
	requestApproval(name) {
		return new Promise((resolve) => {
			const requestId = (0, node_crypto.randomUUID)();
			const timer = setTimeout(() => finish(false), APPROVAL_TIMEOUT_MS);
			const finish = (ok) => {
				clearTimeout(timer);
				this.pending.delete(requestId);
				resolve(ok);
			};
			this.pending.set(requestId, finish);
			this.hooks.askApproval(requestId, name);
		});
	}
};
// src/main/index.ts
var win = null;
function send(channel, payload) {
	if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
var room = new RoomManager({
	binDir: (0, node_path.join)(electron.app.getPath("userData"), "bin"),
	status: (msg) => send("room:status", msg),
	askApproval: (requestId, name) => {
		send("room:join-request", {
			requestId,
			name
		});
		if (win && !win.isFocused()) win.flashFrame(true);
	}
});
function createWindow() {
	win = new electron.BrowserWindow({
		title: "JanJa",
		width: 1280,
		height: 800,
		minWidth: 900,
		minHeight: 600,
		backgroundColor: "#14141a",
		autoHideMenuBar: true,
		webPreferences: {
			preload: (0, node_path.join)(__dirname, "../preload/index.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true
		}
	});
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:/.test(url)) electron.shell.openExternal(url);
		return { action: "deny" };
	});
	win.webContents.on("will-navigate", (e, url) => {
		if (url !== win?.webContents.getURL()) e.preventDefault();
	});
	if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
	else win.loadFile((0, node_path.join)(__dirname, "../renderer/index.html"));
	win.on("closed", () => {
		win = null;
	});
}
electron.app.whenReady().then(() => {
	electron.session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
		callback(permission === "media" || permission === "display-capture" || permission === "clipboard-sanitized-write");
	});
	registerCapture();
	electron.ipcMain.handle("room:create", (_e, opts) => room.create(opts));
	electron.ipcMain.handle("room:close", () => room.close());
	electron.ipcMain.on("room:join-response", (_e, res) => {
		room.respond(String(res.requestId), !!res.approved);
	});
	createWindow();
	electron.app.on("activate", () => {
		if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});
electron.app.on("window-all-closed", () => {
	room.close().finally(() => {
		if (process.platform !== "darwin") electron.app.quit();
	});
});
electron.app.on("before-quit", () => {
	room.close();
});
