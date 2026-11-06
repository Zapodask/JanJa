//! Stub para sistemas que não são Windows: lista um monitor fictício e descarta a entrada.

use crate::engine::{Button, Injector, Monitor};
use crate::keymap::Key;

pub const IS_STUB: bool = true;

pub fn init() {}

pub fn set_title(_title: &str) {}

pub struct NullInjector;

impl Injector for NullInjector {
    fn monitors(&self) -> Vec<Monitor> {
        vec![Monitor { id: 0, x: 0, y: 0, w: 1920, h: 1080, primary: true }]
    }
    // JANJA_STUB_LOG=1 imprime o que seria injetado (útil para testar o fluxo fora do Windows)
    fn move_to(&mut self, x: i32, y: i32) {
        stub_log(format_args!("move {x},{y}"));
    }
    fn button(&mut self, b: Button, down: bool) {
        stub_log(format_args!("button {b:?} {}", if down { "down" } else { "up" }));
    }
    fn wheel(&mut self, dx: i32, dy: i32) {
        stub_log(format_args!("wheel {dx},{dy}"));
    }
    fn key(&mut self, k: Key, down: bool) {
        stub_log(format_args!("key {k:?} {}", if down { "down" } else { "up" }));
    }
}

fn stub_log(args: std::fmt::Arguments) {
    if std::env::var_os("JANJA_STUB_LOG").is_some() {
        println!("[stub] {args}");
    }
}

pub fn injector() -> Box<dyn Injector> {
    Box::new(NullInjector)
}

/// Sem atalho global aqui; como nada é injetado, é seguro seguir.
pub fn register_panic_hotkey() -> Result<(), String> {
    Ok(())
}

pub fn install_exit_hook(_f: Box<dyn Fn() + Send + Sync>) {}

/// Loop principal: no stub só espera.
pub fn run_loop(_on_panic: impl Fn()) {
    loop {
        std::thread::park();
    }
}
