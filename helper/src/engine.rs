//! Estado da sessão de controle: valida eventos, mapeia coordenadas e garante que
//! nenhuma tecla/botão fique preso (tudo é solto ao encerrar, desconectar e no pânico).

use crate::keymap::{self, Key};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Monitor {
    pub id: u32,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub primary: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Button {
    Left,
    Middle,
    Right,
}

impl Button {
    fn from_index(b: u8) -> Option<Self> {
        match b {
            0 => Some(Button::Left),
            1 => Some(Button::Middle),
            2 => Some(Button::Right),
            _ => None,
        }
    }
    fn idx(self) -> usize {
        self as usize
    }
}

/// Backend de entrada (Windows: SendInput). Coordenadas em pixels físicos da área virtual.
pub trait Injector: Send {
    fn monitors(&self) -> Vec<Monitor>;
    fn move_to(&mut self, x: i32, y: i32);
    fn button(&mut self, b: Button, down: bool);
    /// Notches; dy > 0 rola para BAIXO (convenção do navegador, deltaY).
    fn wheel(&mut self, dx: i32, dy: i32);
    fn key(&mut self, k: Key, down: bool);
}

/// Eventos de entrada (mesmo formato do contrato A).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "t")]
pub enum InputEv {
    #[serde(rename = "mm")]
    Mm { x: f64, y: f64 },
    #[serde(rename = "md")]
    Md { b: u8 },
    #[serde(rename = "mu")]
    Mu { b: u8 },
    #[serde(rename = "wh")]
    Wh { dx: f64, dy: f64 },
    #[serde(rename = "kd")]
    Kd { code: String },
    #[serde(rename = "ku")]
    Ku { code: String },
}

/// (x, y) em 0..1 -> pixel dentro do monitor (clampa; NaN/inf -> None).
pub fn map_to_pixels(m: &Monitor, x: f64, y: f64) -> Option<(i32, i32)> {
    if !x.is_finite() || !y.is_finite() || m.w <= 0 || m.h <= 0 {
        return None;
    }
    let px = m.x + (x.clamp(0.0, 1.0) * (m.w - 1) as f64).round() as i32;
    let py = m.y + (y.clamp(0.0, 1.0) * (m.h - 1) as f64).round() as i32;
    Some((px, py))
}

fn notches(v: f64) -> i32 {
    if v.is_finite() { v.round().clamp(-10.0, 10.0) as i32 } else { 0 }
}

pub struct Engine {
    inj: Box<dyn Injector>,
    monitor: Option<Monitor>,
    keys: HashSet<Key>,
    buttons: [bool; 3],
}

impl Engine {
    pub fn new(inj: Box<dyn Injector>) -> Self {
        Engine { inj, monitor: None, keys: HashSet::new(), buttons: [false; 3] }
    }

    pub fn monitors(&self) -> Vec<Monitor> {
        self.inj.monitors()
    }

    #[cfg(test)]
    pub fn active(&self) -> bool {
        self.monitor.is_some()
    }

    /// Inicia sessão no monitor pedido (id desconhecido ou ausente -> primário).
    pub fn start(&mut self, monitor: Option<i64>) -> Result<Monitor, String> {
        self.release_all(); // nunca herda estado
        let list = self.inj.monitors();
        let chosen = monitor
            .and_then(|id| list.iter().find(|m| i64::from(m.id) == id))
            .or_else(|| list.iter().find(|m| m.primary))
            .or_else(|| list.first())
            .copied()
            .ok_or("nenhum monitor encontrado")?;
        self.monitor = Some(chosen);
        Ok(chosen)
    }

    /// Encerra a sessão e solta tudo. Devolve se havia sessão ativa.
    pub fn stop(&mut self) -> bool {
        self.release_all();
        self.monitor.take().is_some()
    }

    pub fn release_all(&mut self) {
        for k in std::mem::take(&mut self.keys) {
            self.inj.key(k, false);
        }
        for (i, b) in [Button::Left, Button::Middle, Button::Right].into_iter().enumerate() {
            if std::mem::replace(&mut self.buttons[i], false) {
                self.inj.button(b, false);
            }
        }
    }

    /// Ignora tudo se não houver sessão ativa.
    pub fn input(&mut self, ev: &InputEv) {
        let Some(mon) = self.monitor else { return };
        match ev {
            InputEv::Mm { x, y } => {
                if let Some((px, py)) = map_to_pixels(&mon, *x, *y) {
                    self.inj.move_to(px, py);
                }
            }
            InputEv::Md { b } => {
                if let Some(b) = Button::from_index(*b) {
                    if !self.buttons[b.idx()] {
                        self.buttons[b.idx()] = true;
                        self.inj.button(b, true);
                    }
                }
            }
            InputEv::Mu { b } => {
                if let Some(b) = Button::from_index(*b) {
                    if self.buttons[b.idx()] {
                        self.buttons[b.idx()] = false;
                        self.inj.button(b, false);
                    }
                }
            }
            InputEv::Wh { dx, dy } => {
                let (dx, dy) = (notches(*dx), notches(*dy));
                if dx != 0 || dy != 0 {
                    self.inj.wheel(dx, dy);
                }
            }
            InputEv::Kd { code } => {
                if let Some(k) = keymap::lookup(code) {
                    self.keys.insert(k);
                    self.inj.key(k, true); // repetição do navegador vira auto-repeat
                }
            }
            InputEv::Ku { code } => {
                if let Some(k) = keymap::lookup(code) {
                    if self.keys.remove(&k) {
                        self.inj.key(k, false);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[derive(Debug, Clone, PartialEq)]
    pub enum Ev {
        Move(i32, i32),
        Btn(Button, bool),
        Wheel(i32, i32),
        Key(u16, bool),
    }

    #[derive(Clone, Default)]
    pub struct Rec(pub Arc<Mutex<Vec<Ev>>>);

    pub struct FakeInj(pub Rec, pub Vec<Monitor>);

    impl Injector for FakeInj {
        fn monitors(&self) -> Vec<Monitor> { self.1.clone() }
        fn move_to(&mut self, x: i32, y: i32) { self.0.0.lock().unwrap().push(Ev::Move(x, y)) }
        fn button(&mut self, b: Button, d: bool) { self.0.0.lock().unwrap().push(Ev::Btn(b, d)) }
        fn wheel(&mut self, dx: i32, dy: i32) { self.0.0.lock().unwrap().push(Ev::Wheel(dx, dy)) }
        fn key(&mut self, k: Key, d: bool) { self.0.0.lock().unwrap().push(Ev::Key(k.scan, d)) }
    }

    pub fn two_monitors() -> Vec<Monitor> {
        vec![
            Monitor { id: 0, x: -1920, y: 0, w: 1920, h: 1080, primary: false },
            Monitor { id: 1, x: 0, y: 0, w: 2560, h: 1440, primary: true },
        ]
    }

    fn engine() -> (Engine, Rec) {
        let rec = Rec::default();
        (Engine::new(Box::new(FakeInj(rec.clone(), two_monitors()))), rec)
    }

    fn take(r: &Rec) -> Vec<Ev> {
        std::mem::take(&mut *r.0.lock().unwrap())
    }

    fn ev(json: &str) -> InputEv {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn pixel_mapping() {
        let m = Monitor { id: 1, x: 100, y: 50, w: 1920, h: 1080, primary: true };
        assert_eq!(map_to_pixels(&m, 0.0, 0.0), Some((100, 50)));
        assert_eq!(map_to_pixels(&m, 1.0, 1.0), Some((100 + 1919, 50 + 1079)));
        assert_eq!(map_to_pixels(&m, 0.5, 0.5), Some((100 + 960, 50 + 540))); // 959.5 arredonda para 960
        assert_eq!(map_to_pixels(&m, -3.0, 9.0), Some((100, 50 + 1079)));
        assert_eq!(map_to_pixels(&m, f64::NAN, 0.0), None);
        assert_eq!(map_to_pixels(&m, 0.0, f64::INFINITY), None);
        let neg = Monitor { id: 0, x: -1920, y: 0, w: 1920, h: 1080, primary: false };
        assert_eq!(map_to_pixels(&neg, 0.0, 0.0), Some((-1920, 0)));
        assert_eq!(map_to_pixels(&neg, 1.0, 0.0), Some((-1, 0)));
    }

    #[test]
    fn input_ignored_without_session() {
        let (mut e, r) = engine();
        e.input(&ev(r#"{"t":"mm","x":0.5,"y":0.5}"#));
        e.input(&ev(r#"{"t":"kd","code":"KeyA"}"#));
        e.input(&ev(r#"{"t":"md","b":0}"#));
        assert!(take(&r).is_empty());
        assert!(!e.stop());
    }

    #[test]
    fn default_monitor_is_primary_and_unknown_falls_back() {
        let (mut e, r) = engine();
        assert_eq!(e.start(None).unwrap().id, 1);
        e.input(&ev(r#"{"t":"mm","x":0,"y":0}"#));
        assert_eq!(take(&r), vec![Ev::Move(0, 0)]);
        assert_eq!(e.start(Some(99)).unwrap().id, 1);
        assert_eq!(e.start(Some(0)).unwrap().id, 0);
        e.input(&ev(r#"{"t":"mm","x":1,"y":1}"#));
        assert_eq!(take(&r), vec![Ev::Move(-1, 1079)]);
    }

    #[test]
    fn releases_everything_on_stop() {
        let (mut e, r) = engine();
        e.start(None).unwrap();
        e.input(&ev(r#"{"t":"kd","code":"ControlLeft"}"#));
        e.input(&ev(r#"{"t":"kd","code":"ArrowLeft"}"#));
        e.input(&ev(r#"{"t":"md","b":0}"#));
        e.input(&ev(r#"{"t":"md","b":2}"#));
        e.input(&ev(r#"{"t":"mu","b":2}"#));
        take(&r);
        assert!(e.stop());
        let out = take(&r);
        assert!(out.contains(&Ev::Key(0x1D, false)));
        assert!(out.contains(&Ev::Key(0x4B, false)));
        assert!(out.contains(&Ev::Btn(Button::Left, false)));
        assert!(!out.contains(&Ev::Btn(Button::Right, false))); // já tinha soltado
        assert_eq!(out.len(), 3);
        assert!(!e.active());
        // depois de parar, nada passa e nada é solto de novo
        e.input(&ev(r#"{"t":"kd","code":"KeyA"}"#));
        assert!(take(&r).is_empty());
        assert!(!e.stop());
        assert!(take(&r).is_empty());
    }

    #[test]
    fn start_clears_leftover_state() {
        let (mut e, r) = engine();
        e.start(None).unwrap();
        e.input(&ev(r#"{"t":"kd","code":"ShiftLeft"}"#));
        take(&r);
        e.start(None).unwrap();
        assert_eq!(take(&r), vec![Ev::Key(0x2A, false)]);
    }

    #[test]
    fn keys_buttons_wheel_rules() {
        let (mut e, r) = engine();
        e.start(None).unwrap();
        e.input(&ev(r#"{"t":"ku","code":"KeyA"}"#)); // up sem down: ignora
        e.input(&ev(r#"{"t":"kd","code":"Bogus"}"#)); // desconhecida: ignora
        e.input(&ev(r#"{"t":"md","b":3}"#)); // botão inválido: ignora
        e.input(&ev(r#"{"t":"md","b":1}"#));
        e.input(&ev(r#"{"t":"md","b":1}"#)); // duplicado: ignora
        e.input(&ev(r#"{"t":"wh","dx":0,"dy":0}"#));
        e.input(&ev(r#"{"t":"wh","dx":2.4,"dy":99}"#));
        e.input(&ev(r#"{"t":"kd","code":"KeyA"}"#));
        e.input(&ev(r#"{"t":"kd","code":"KeyA"}"#)); // auto-repeat passa
        e.input(&ev(r#"{"t":"ku","code":"KeyA"}"#));
        assert_eq!(
            take(&r),
            vec![
                Ev::Btn(Button::Middle, true),
                Ev::Wheel(2, 10),
                Ev::Key(0x1E, true),
                Ev::Key(0x1E, true),
                Ev::Key(0x1E, false),
            ]
        );
    }

    #[test]
    fn rejects_malformed_events() {
        assert!(serde_json::from_str::<InputEv>(r#"{"t":"zz"}"#).is_err());
        assert!(serde_json::from_str::<InputEv>(r#"{"t":"mm","x":"a","y":1}"#).is_err());
        assert!(serde_json::from_str::<InputEv>(r#"{"t":"md","b":-1}"#).is_err());
        assert!(serde_json::from_str::<InputEv>(r#"{"t":"md","b":300}"#).is_err());
    }
}
