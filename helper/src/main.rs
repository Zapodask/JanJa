mod config;
mod engine;
mod keymap;
mod pairing;
mod platform;
mod server;

use std::net::TcpListener;
use std::sync::atomic::Ordering;

const USAGE: &str = "JanJa Helper - controle remoto do mouse e teclado para o JanJa.

Uso:
  janja-helper.exe                      inicia o helper
  janja-helper.exe --allow <origem>     libera uma origem (ex.: https://janja.exemplo.workers.dev) e sai
  janja-helper.exe --help";

fn pause_and_exit(code: i32) -> ! {
    println!("\nPressione Enter para fechar.");
    let mut s = String::new();
    let _ = std::io::stdin().read_line(&mut s);
    std::process::exit(code);
}

fn fatal(msg: &str) -> ! {
    eprintln!("Erro: {msg}");
    pause_and_exit(1)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cfg_path = config::config_path().unwrap_or_else(|e| fatal(&e));
    let mut cfg = config::load(&cfg_path).unwrap_or_else(|e| fatal(&e));

    match args.first().map(String::as_str) {
        Some("--help" | "-h") => {
            println!("{USAGE}");
            return;
        }
        Some("--allow") => {
            let Some(origin) = args.get(1) else {
                eprintln!("Faltou a origem.\n\n{USAGE}");
                std::process::exit(2);
            };
            match cfg.add_origin(origin).and_then(|o| config::save(&cfg_path, &cfg).map(|_| o)) {
                Ok(o) => println!("Origem liberada: {o}\nConfiguração: {}", cfg_path.display()),
                Err(e) => {
                    eprintln!("Erro: {e}");
                    std::process::exit(1);
                }
            }
            return;
        }
        Some(other) => {
            eprintln!("Argumento desconhecido: {other}\n\n{USAGE}");
            std::process::exit(2);
        }
        None => {}
    }

    platform::init();
    if !cfg_path.exists() {
        let _ = config::save(&cfg_path, &cfg);
    }
    platform::set_title("JanJa Helper - aguardando");

    println!("=== JanJa Helper {} ===", env!("CARGO_PKG_VERSION"));
    if platform::IS_STUB {
        println!("[aviso] Esta build não é para Windows: nenhuma entrada será injetada (modo de desenvolvimento).");
    }
    println!("Escutando só em 127.0.0.1:{}", server::PORT);
    println!("Origens permitidas:");
    for o in &cfg.origins {
        println!("  - {o}");
    }
    println!("Para liberar o seu site:  janja-helper.exe --allow https://seu-site.workers.dev  (e reinicie o helper)");
    println!("Pânico (corta o controle na hora):  Ctrl+Alt+Shift+P");
    println!("Para sair, feche esta janela.\n");

    let shared = server::Shared::new(cfg, cfg_path, platform::injector());

    // O atalho de pânico precisa ser registrado na thread que roda o loop de mensagens (esta).
    match platform::register_panic_hotkey() {
        Ok(()) => shared.panic_key_ok.store(true, Ordering::Relaxed),
        Err(e) => println!("[!] {e}\n    Sem o atalho de pânico, o helper RECUSA qualquer sessão de controle."),
    }

    let listener = TcpListener::bind(("127.0.0.1", server::PORT))
        .unwrap_or_else(|e| fatal(&format!("não consegui abrir 127.0.0.1:{} ({e}). Já existe outro helper aberto?", server::PORT)));

    let s = shared.clone();
    platform::install_exit_hook(Box::new(move || s.shutdown()));

    let s = shared.clone();
    std::thread::spawn(move || server::serve(listener, s));

    println!("Pronto. Aguardando a página do JanJa...");
    let s = shared.clone();
    platform::run_loop(move || s.panic());
}
