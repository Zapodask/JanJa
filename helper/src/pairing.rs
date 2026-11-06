//! Código de pareamento de 6 dígitos, geração de token e limite de tentativas.

use crate::config::ct_eq;
use base64::Engine as _;
use std::time::{Duration, Instant};

pub const MAX_WRONG: u32 = 5;
pub const LOCK_FOR: Duration = Duration::from_secs(60);

#[derive(Debug, PartialEq, Eq)]
pub enum PairResult {
    Ok,
    Wrong { left: u32 },
    Locked { secs: u64 },
    NoCode,
}

#[derive(Default)]
pub struct Pairing {
    code: Option<String>,
    wrong: u32,
    locked_until: Option<Instant>,
}

impl Pairing {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn locked_secs(&self, now: Instant) -> Option<u64> {
        self.locked_until
            .filter(|t| *t > now)
            .map(|t| (t - now).as_secs() + 1)
    }

    /// Gera (e guarda) um novo código. None se estiver em bloqueio.
    pub fn new_code(&mut self, now: Instant) -> Option<String> {
        if self.locked_secs(now).is_some() {
            return None;
        }
        let n: u32 = rand::random_range(0..1_000_000);
        let c = format!("{n:06}");
        self.code = Some(c.clone());
        Some(c)
    }

    pub fn try_pair(&mut self, given: &str, now: Instant) -> PairResult {
        if let Some(secs) = self.locked_secs(now) {
            return PairResult::Locked { secs };
        }
        let Some(code) = self.code.clone() else { return PairResult::NoCode };
        if ct_eq(code.as_bytes(), given.trim().as_bytes()) {
            self.code = None;
            self.wrong = 0;
            return PairResult::Ok;
        }
        self.wrong += 1;
        if self.wrong >= MAX_WRONG {
            self.wrong = 0;
            self.code = None; // o código queimou
            self.locked_until = Some(now + LOCK_FOR);
            return PairResult::Locked { secs: LOCK_FOR.as_secs() };
        }
        PairResult::Wrong { left: MAX_WRONG - self.wrong }
    }

    #[cfg(test)]
    pub fn force_code(&mut self, c: &str) {
        self.code = Some(c.to_string());
    }
}

/// 32 bytes aleatórios em base64url sem padding (43 caracteres).
pub fn new_token() -> String {
    let mut b = [0u8; 32];
    rand::fill(&mut b[..]);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_shape() {
        let mut p = Pairing::new();
        let c = p.new_code(Instant::now()).unwrap();
        assert_eq!(c.len(), 6);
        assert!(c.bytes().all(|b| b.is_ascii_digit()));
    }

    #[test]
    fn token_shape() {
        let t = new_token();
        assert_eq!(t.len(), 43);
        assert!(t.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'));
        assert_ne!(t, new_token());
    }

    #[test]
    fn right_code_pairs_once() {
        let now = Instant::now();
        let mut p = Pairing::new();
        p.force_code("123456");
        assert_eq!(p.try_pair("123456", now), PairResult::Ok);
        assert_eq!(p.try_pair("123456", now), PairResult::NoCode);
    }

    #[test]
    fn five_wrong_locks_for_60s() {
        let t0 = Instant::now();
        let mut p = Pairing::new();
        p.force_code("123456");
        for i in 1..5 {
            assert_eq!(p.try_pair("000000", t0), PairResult::Wrong { left: 5 - i });
        }
        assert_eq!(p.try_pair("000000", t0), PairResult::Locked { secs: 60 });
        // mesmo com o código certo, bloqueado e sem código novo
        assert!(matches!(p.try_pair("123456", t0 + Duration::from_secs(30)), PairResult::Locked { .. }));
        assert!(p.new_code(t0 + Duration::from_secs(30)).is_none());
        // depois dos 60 s volta; o código antigo foi queimado
        let t1 = t0 + Duration::from_secs(61);
        assert_eq!(p.try_pair("123456", t1), PairResult::NoCode);
        assert!(p.new_code(t1).is_some());
    }

    #[test]
    fn success_resets_counter() {
        let now = Instant::now();
        let mut p = Pairing::new();
        p.force_code("111111");
        for _ in 0..4 {
            p.try_pair("x", now);
        }
        assert_eq!(p.try_pair("111111", now), PairResult::Ok);
        p.force_code("222222");
        assert_eq!(p.try_pair("x", now), PairResult::Wrong { left: 4 });
    }
}
