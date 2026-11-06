//! Servidor WebSocket (127.0.0.1) e protocolo página <-> helper (contrato B).

use crate::config::{self, Config};
use crate::engine::{Engine, InputEv, Monitor};
use crate::pairing::{self, PairResult, Pairing};
use crate::platform;
use serde::{Deserialize, Serialize};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tungstenite::protocol::WebSocketConfig;
use tungstenite::{Error as WsError, Message};

pub const PORT: u16 = 47800;
pub const VERSION: u32 = 1;
const MAX_MSG: usize = 4096;
const POLL: Duration = Duration::from_millis(100);

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum ClientMsg {
    Hello { token: Option<String> },
    Pair { code: String },
    #[serde(rename_all = "camelCase")]
    Session { active: bool, monitor: Option<i64>, peer_name: Option<String> },
    Input { ev: serde_json::Value },
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Out {
    NeedPair,
    Paired { token: String },
    Ready { monitors: Vec<Monitor>, version: u32 },
    Panic,
    Error { message: String },
}

pub struct Shared {
    cfg: Mutex<Config>,
    cfg_path: PathBuf,
    pairing: Mutex<Pairing>,
    engine: Mutex<Engine>,
    conn: Mutex<Option<Sender<Out>>>,
    /// Sem o atalho de pânico registrado, nenhuma sessão é aceita.
    pub panic_key_ok: AtomicBool,
    port: AtomicU16,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Remove caracteres de controle (evita injetar escapes no console) e limita o tamanho.
pub fn sanitize_name(s: &str) -> String {
    s.chars().filter(|c| !c.is_control()).take(40).collect()
}

impl Shared {
    pub fn new(cfg: Config, cfg_path: PathBuf, inj: Box<dyn crate::engine::Injector>) -> Arc<Self> {
        Arc::new(Shared {
            cfg: Mutex::new(cfg),
            cfg_path,
            pairing: Mutex::new(Pairing::new()),
            engine: Mutex::new(Engine::new(inj)),
            conn: Mutex::new(None),
            panic_key_ok: AtomicBool::new(false),
            port: AtomicU16::new(PORT),
        })
    }

    /// Atalho global de pânico: corta tudo na hora e avisa a página.
    pub fn panic(&self) {
        let was_active = lock(&self.engine).stop();
        platform::set_title("JanJa Helper - pânico acionado");
        println!("[!] PÂNICO: controle encerrado{}.", if was_active { "" } else { " (não havia sessão ativa)" });
        if let Some(tx) = lock(&self.conn).as_ref() {
            let _ = tx.send(Out::Panic);
        }
    }

    /// Para o encerramento do processo (Ctrl+C, fechar console).
    pub fn shutdown(&self) {
        lock(&self.engine).stop();
    }

    fn host_ok(&self, host: Option<&str>) -> bool {
        let p = self.port.load(Ordering::Relaxed);
        matches!(host, Some(h) if h.eq_ignore_ascii_case(&format!("127.0.0.1:{p}")) || h.eq_ignore_ascii_case(&format!("localhost:{p}")))
    }
}

/// Libera a vaga de "uma conexão por vez" ao sair, em qualquer caminho.
struct Slot<'a>(&'a Shared);
impl Drop for Slot<'_> {
    fn drop(&mut self) {
        *lock(&self.0.conn) = None;
    }
}

pub fn serve(listener: TcpListener, shared: Arc<Shared>) {
    if let Ok(a) = listener.local_addr() {
        shared.port.store(a.port(), Ordering::Relaxed);
    }
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        let shared = shared.clone();
        std::thread::spawn(move || handle_conn(stream, shared));
    }
}

fn reject(status: u16, msg: &str) -> ErrorResponse {
    tungstenite::http::Response::builder()
        .status(status)
        .body(Some(msg.to_string()))
        .unwrap_or_else(|_| tungstenite::http::Response::new(None))
}

fn handle_conn(stream: TcpStream, shared: Arc<Shared>) {
    // Defesa extra: só loopback.
    if !stream.peer_addr().map(|a| a.ip().is_loopback()).unwrap_or(false) {
        return;
    }
    let _ = stream.set_nodelay(true);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));

    let mut accepted: Option<(Receiver<Out>, String)> = None;
    let sh = shared.clone();
    let callback = |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
        let origin = req.headers().get("origin").and_then(|v| v.to_str().ok());
        if !lock(&sh.cfg).origin_allowed(origin) {
            println!("[!] Conexão recusada: origem não permitida ({}). Para liberar: janja-helper.exe --allow <origem>", origin.unwrap_or("sem Origin"));
            return Err(reject(403, "origin not allowed"));
        }
        let host = req.headers().get("host").and_then(|v| v.to_str().ok());
        if !sh.host_ok(host) {
            return Err(reject(403, "bad host"));
        }
        let mut conn = lock(&sh.conn);
        if conn.is_some() {
            return Err(reject(409, "another page is connected"));
        }
        let (tx, rx) = mpsc::channel();
        *conn = Some(tx);
        accepted = Some((rx, sanitize_name(origin.unwrap_or(""))));
        Ok(resp)
    };
    let cfg = WebSocketConfig::default()
        .max_message_size(Some(MAX_MSG))
        .max_frame_size(Some(MAX_MSG))
        .read_buffer_size(8 * 1024)
        .write_buffer_size(0);
    let ws = tungstenite::accept_hdr_with_config(stream, callback, Some(cfg)).ok();
    // A vaga (se foi tomada) é liberada ao sair desta função.
    let _slot = accepted.as_ref().map(|_| Slot(&shared));
    let Some(mut ws) = ws else { return };
    let Some((rx, origin)) = accepted else { return };

    let _ = ws.get_ref().set_read_timeout(Some(POLL));
    println!("[+] Página conectada ({origin}).");
    conn_loop(&shared, &mut ws, &rx, &origin);
    // Desconectou: solta tudo.
    if lock(&shared.engine).stop() {
        platform::set_title("JanJa Helper - aguardando");
        println!("[-] Conexão encerrada: controle parado e teclas soltas.");
    } else {
        println!("[-] Página desconectada.");
    }
}

fn send(ws: &mut tungstenite::WebSocket<TcpStream>, out: &Out) -> bool {
    let Ok(s) = serde_json::to_string(out) else { return false };
    ws.send(Message::text(s)).is_ok()
}

fn conn_loop(shared: &Shared, ws: &mut tungstenite::WebSocket<TcpStream>, rx: &Receiver<Out>, origin: &str) {
    let mut authed = false;
    loop {
        while let Ok(out) = rx.try_recv() {
            if !send(ws, &out) {
                return;
            }
        }
        let _ = ws.flush();
        match ws.read() {
            Ok(Message::Text(t)) => {
                for out in handle_text(shared, &mut authed, origin, t.as_str()) {
                    if !send(ws, &out) {
                        return;
                    }
                }
            }
            Ok(Message::Close(_)) => return,
            Ok(_) => {}
            Err(WsError::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
            Err(_) => return,
        }
    }
}

fn err(m: &str) -> Out {
    Out::Error { message: m.to_string() }
}

fn ready(shared: &Shared) -> Out {
    Out::Ready { monitors: lock(&shared.engine).monitors(), version: VERSION }
}

/// Processa uma mensagem de texto da página; devolve as respostas.
pub fn handle_text(shared: &Shared, authed: &mut bool, origin: &str, text: &str) -> Vec<Out> {
    let Ok(msg) = serde_json::from_str::<ClientMsg>(text) else {
        return vec![err("mensagem inválida")];
    };
    match msg {
        ClientMsg::Hello { token } => {
            if token.as_deref().is_some_and(|t| lock(&shared.cfg).token_valid(t)) {
                *authed = true;
                return vec![ready(shared)];
            }
            *authed = false;
            let mut outs = vec![];
            let mut p = lock(&shared.pairing);
            match p.new_code(Instant::now()) {
                Some(code) => {
                    println!("[?] Pedido de pareamento de {origin}");
                    println!("    Digite este código na página JanJa:  {code}");
                }
                None => {
                    let s = p.locked_secs(Instant::now()).unwrap_or(60);
                    outs.push(err(&format!("pareamento bloqueado por mais {s} s")));
                }
            }
            outs.push(Out::NeedPair);
            outs
        }
        ClientMsg::Pair { code } => {
            if *authed {
                return vec![err("já pareado")];
            }
            let r = lock(&shared.pairing).try_pair(&code, Instant::now());
            match r {
                PairResult::Ok => {
                    let token = pairing::new_token();
                    let hash = config::hash_token(&token);
                    let mut cfg = lock(&shared.cfg);
                    cfg.add_token_hash(hash);
                    if let Err(e) = config::save(&shared.cfg_path, &cfg) {
                        println!("[!] {e}");
                        return vec![err("não consegui gravar a configuração do helper")];
                    }
                    drop(cfg);
                    println!("[+] Pareado com {origin}.");
                    *authed = true;
                    vec![Out::Paired { token }, ready(shared)]
                }
                PairResult::Wrong { left } => vec![err(&format!("código incorreto ({left} tentativas restantes)"))],
                PairResult::Locked { secs } => {
                    println!("[!] 5 códigos errados: pareamento bloqueado por {secs} s.");
                    vec![err(&format!("pareamento bloqueado por {secs} s"))]
                }
                PairResult::NoCode => vec![err("sem código ativo; envie hello de novo"), Out::NeedPair],
            }
        }
        ClientMsg::Session { active, monitor, peer_name } => {
            if !*authed {
                return vec![Out::NeedPair];
            }
            let mut eng = lock(&shared.engine);
            if !active {
                if eng.stop() {
                    platform::set_title("JanJa Helper - aguardando");
                    println!("[-] Controle encerrado. Teclas e botões soltos.");
                }
                return vec![];
            }
            if !shared.panic_key_ok.load(Ordering::Relaxed) {
                return vec![err("atalho de pânico indisponível; sessão recusada")];
            }
            match eng.start(monitor) {
                Ok(m) => {
                    let who = peer_name.as_deref().map(sanitize_name).filter(|s| !s.is_empty()).unwrap_or_else(|| "alguém".into());
                    platform::set_title(&format!("JanJa Helper - CONTROLE ATIVO ({who})"));
                    println!("[*] CONTROLE ATIVO: {who} controla o monitor {} ({}x{}). Pânico: Ctrl+Alt+Shift+P", m.id, m.w, m.h);
                    vec![]
                }
                Err(e) => vec![err(&e)],
            }
        }
        ClientMsg::Input { ev } => {
            if !*authed {
                return vec![];
            }
            if let Ok(ev) = serde_json::from_value::<InputEv>(ev) {
                lock(&shared.engine).input(&ev);
            }
            vec![]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::tests::{two_monitors, Ev, FakeInj, Rec};
    use tungstenite::client::IntoClientRequest;

    fn setup() -> (Arc<Shared>, Rec, u16) {
        let rec = Rec::default();
        let path = std::env::temp_dir().join(format!("janja-srv-{}-{:?}.json", std::process::id(), std::thread::current().id()));
        let shared = Shared::new(Config::default(), path, Box::new(FakeInj(rec.clone(), two_monitors())));
        shared.panic_key_ok.store(true, Ordering::Relaxed);
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let sh = shared.clone();
        std::thread::spawn(move || serve(l, sh));
        std::thread::sleep(Duration::from_millis(50));
        (shared, rec, port)
    }

    type Client = tungstenite::WebSocket<TcpStream>;

    fn connect(port: u16, origin: Option<&str>) -> Result<Client, String> {
        let s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        let mut req = format!("ws://127.0.0.1:{port}").into_client_request().unwrap();
        if let Some(o) = origin {
            req.headers_mut().insert("origin", o.parse().unwrap());
        }
        tungstenite::client(req, s).map(|(ws, _)| ws).map_err(|e| e.to_string())
    }

    fn tx(ws: &mut Client, v: serde_json::Value) {
        ws.send(Message::text(v.to_string())).unwrap();
    }

    fn rxj(ws: &mut Client) -> serde_json::Value {
        loop {
            if let Message::Text(t) = ws.read().unwrap() {
                return serde_json::from_str(t.as_str()).unwrap();
            }
        }
    }

    const OK: &str = "http://localhost:8787";

    #[test]
    fn rejects_bad_or_missing_origin() {
        let (_s, _r, port) = setup();
        assert!(connect(port, None).is_err());
        assert!(connect(port, Some("https://evil.example")).is_err());
        assert!(connect(port, Some("null")).is_err());
        assert!(connect(port, Some(OK)).is_ok());
    }

    #[test]
    fn pairing_flow_and_token_reuse() {
        let (shared, rec, port) = setup();
        let mut ws = connect(port, Some(OK)).unwrap();
        tx(&mut ws, serde_json::json!({"type":"hello","version":1}));
        assert_eq!(rxj(&mut ws)["type"], "need-pair");
        // input sem estar pareado é ignorado
        tx(&mut ws, serde_json::json!({"type":"session","active":true}));
        assert_eq!(rxj(&mut ws)["type"], "need-pair");
        tx(&mut ws, serde_json::json!({"type":"pair","code":"abcdef"}));
        let e = rxj(&mut ws);
        assert_eq!(e["type"], "error");
        let code = {
            let mut p = lock(&shared.pairing);
            p.force_code("424242");
            "424242"
        };
        tx(&mut ws, serde_json::json!({"type":"pair","code":code}));
        let paired = rxj(&mut ws);
        assert_eq!(paired["type"], "paired");
        let token = paired["token"].as_str().unwrap().to_string();
        assert_eq!(token.len(), 43);
        let ready = rxj(&mut ws);
        assert_eq!(ready["type"], "ready");
        assert_eq!(ready["version"], 1);
        assert_eq!(ready["monitors"].as_array().unwrap().len(), 2);
        assert_eq!(ready["monitors"][1]["primary"], true);
        // só o hash foi guardado
        {
            let cfg = lock(&shared.cfg);
            assert_eq!(cfg.tokens, vec![config::hash_token(&token)]);
            assert!(!cfg.tokens.contains(&token));
        }
        drop(ws);
        std::thread::sleep(Duration::from_millis(300));
        // reconecta com token
        let mut ws = connect(port, Some(OK)).unwrap();
        tx(&mut ws, serde_json::json!({"type":"hello","token":token,"version":1}));
        assert_eq!(rxj(&mut ws)["type"], "ready");
        // token errado
        drop(ws);
        std::thread::sleep(Duration::from_millis(300));
        let mut ws = connect(port, Some(OK)).unwrap();
        tx(&mut ws, serde_json::json!({"type":"hello","token":"x"}));
        assert_eq!(rxj(&mut ws)["type"], "need-pair");
        assert!(rec.0.lock().unwrap().is_empty());
        let _ = std::fs::remove_file(&shared.cfg_path);
    }

    fn authed_session(port: u16, shared: &Shared) -> Client {
        let t = "tok-de-teste";
        lock(&shared.cfg).add_token_hash(config::hash_token(t));
        let mut ws = connect(port, Some(OK)).unwrap();
        tx(&mut ws, serde_json::json!({"type":"hello","token":t,"version":1}));
        assert_eq!(rxj(&mut ws)["type"], "ready");
        ws
    }

    #[test]
    fn input_only_in_active_session_and_released_on_disconnect() {
        let (shared, rec, port) = setup();
        let mut ws = authed_session(port, &shared);
        tx(&mut ws, serde_json::json!({"type":"input","ev":{"t":"kd","code":"KeyA"}}));
        tx(&mut ws, serde_json::json!({"type":"session","active":true,"monitor":1,"peerName":"Bia\u{1b}[31m"}));
        tx(&mut ws, serde_json::json!({"type":"input","ev":{"t":"mm","x":0.0,"y":0.0}}));
        tx(&mut ws, serde_json::json!({"type":"input","ev":{"t":"kd","code":"ShiftLeft"}}));
        tx(&mut ws, serde_json::json!({"type":"input","ev":{"t":"md","b":0}}));
        tx(&mut ws, serde_json::json!({"type":"input","ev":{"t":"lixo"}}));
        std::thread::sleep(Duration::from_millis(400));
        let got = rec.0.lock().unwrap().clone();
        assert_eq!(got, vec![Ev::Move(0, 0), Ev::Key(0x2A, true), Ev::Btn(crate::engine::Button::Left, true)]);
        rec.0.lock().unwrap().clear();
        drop(ws); // desconecta com tecla e botão pressionados
        std::thread::sleep(Duration::from_millis(500));
        let got = rec.0.lock().unwrap().clone();
        assert!(got.contains(&Ev::Key(0x2A, false)), "{got:?}");
        assert!(got.contains(&Ev::Btn(crate::engine::Button::Left, false)), "{got:?}");
        assert!(!lock(&shared.engine).active());
    }

    #[test]
    fn panic_releases_and_notifies() {
        let (shared, rec, port) = setup();
        let mut ws = authed_session(port, &shared);
        tx(&mut ws, serde_json::json!({"type":"session","active":true}));
        tx(&mut ws, serde_json::json!({"type":"input","ev":{"t":"kd","code":"ControlLeft"}}));
        std::thread::sleep(Duration::from_millis(300));
        rec.0.lock().unwrap().clear();
        shared.panic();
        assert_eq!(rxj(&mut ws)["type"], "panic");
        assert_eq!(*rec.0.lock().unwrap(), vec![Ev::Key(0x1D, false)]);
        // sem nova sessão, input é descartado
        tx(&mut ws, serde_json::json!({"type":"input","ev":{"t":"kd","code":"KeyB"}}));
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(rec.0.lock().unwrap().len(), 1);
    }

    #[test]
    fn session_refused_without_panic_hotkey() {
        let (shared, rec, port) = setup();
        shared.panic_key_ok.store(false, Ordering::Relaxed);
        let mut ws = authed_session(port, &shared);
        tx(&mut ws, serde_json::json!({"type":"session","active":true}));
        assert_eq!(rxj(&mut ws)["type"], "error");
        tx(&mut ws, serde_json::json!({"type":"input","ev":{"t":"kd","code":"KeyA"}}));
        std::thread::sleep(Duration::from_millis(300));
        assert!(rec.0.lock().unwrap().is_empty());
    }

    #[test]
    fn only_one_page_at_a_time() {
        let (_s, _r, port) = setup();
        let first = connect(port, Some(OK)).unwrap();
        assert!(connect(port, Some(OK)).is_err());
        drop(first);
        std::thread::sleep(Duration::from_millis(400));
        assert!(connect(port, Some(OK)).is_ok());
    }

    #[test]
    fn pairing_lockout_over_ws() {
        let (_s, _r, port) = setup();
        let mut ws = connect(port, Some(OK)).unwrap();
        tx(&mut ws, serde_json::json!({"type":"hello"}));
        assert_eq!(rxj(&mut ws)["type"], "need-pair");
        for _ in 0..5 {
            tx(&mut ws, serde_json::json!({"type":"pair","code":"nope"}));
            assert_eq!(rxj(&mut ws)["type"], "error");
        }
        tx(&mut ws, serde_json::json!({"type":"hello"}));
        let e = rxj(&mut ws);
        assert_eq!(e["type"], "error");
        assert!(e["message"].as_str().unwrap().contains("bloqueado"));
    }

    #[test]
    fn name_sanitized() {
        assert_eq!(sanitize_name("Bia\u{1b}[2J\n"), "Bia[2J");
        assert_eq!(sanitize_name(&"a".repeat(100)).len(), 40);
    }
}
