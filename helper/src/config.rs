//! Configuração em %APPDATA%\JanJa\helper.json: origens permitidas e hashes de tokens.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

/// O site publicado já vem liberado, para ninguém precisar rodar --allow.
pub const DEFAULT_ORIGINS: [&str; 3] = [
    "https://janja.spotlightre.workers.dev",
    "http://localhost:8787",
    "http://127.0.0.1:8787",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Config {
    #[serde(default = "default_origins")]
    pub origins: Vec<String>,
    /// SHA-256 (hex) dos tokens emitidos. O token em si nunca é guardado.
    #[serde(default)]
    pub tokens: Vec<String>,
}

/// Endereços antigos do site: saem da config salva ao carregar.
pub const RETIRED_ORIGINS: [&str; 1] = ["https://janja.pvpswapedro123.workers.dev"];

fn default_origins() -> Vec<String> {
    DEFAULT_ORIGINS.iter().map(|s| s.to_string()).collect()
}

impl Default for Config {
    fn default() -> Self {
        Config { origins: default_origins(), tokens: vec![] }
    }
}

/// Normaliza uma origem: só esquema http(s) + host[:porta], minúscula, sem barra final nem caminho.
pub fn normalize_origin(s: &str) -> Option<String> {
    let s = s.trim().trim_end_matches('/').to_ascii_lowercase();
    let rest = s.strip_prefix("https://").or_else(|| s.strip_prefix("http://"))?;
    if rest.is_empty() || rest.contains(['/', '?', '#', '@', ' ']) {
        return None;
    }
    Some(s)
}

impl Config {
    /// Origem ausente ou fora da lista -> false.
    pub fn origin_allowed(&self, origin: Option<&str>) -> bool {
        let Some(o) = origin.and_then(normalize_origin) else { return false };
        self.origins.iter().any(|a| normalize_origin(a).as_deref() == Some(o.as_str()))
    }

    /// Config salva por versões antigas: tira endereços aposentados e garante os oficiais.
    pub fn migrate_origins(&mut self) {
        let retired: Vec<String> = RETIRED_ORIGINS.iter().filter_map(|o| normalize_origin(o)).collect();
        self.origins.retain(|o| !normalize_origin(o).is_some_and(|n| retired.contains(&n)));
        for o in DEFAULT_ORIGINS {
            let _ = self.add_origin(o);
        }
    }

    pub fn add_origin(&mut self, origin: &str) -> Result<String, String> {
        let o = normalize_origin(origin)
            .ok_or_else(|| format!("origem inválida: {origin} (use algo como https://janja.exemplo.workers.dev)"))?;
        if !self.origins.iter().any(|a| normalize_origin(a).as_deref() == Some(o.as_str())) {
            self.origins.push(o.clone());
        }
        Ok(o)
    }

    pub fn token_valid(&self, token: &str) -> bool {
        let h = hash_token(token);
        // Compara todos, sem curto-circuito.
        self.tokens.iter().fold(false, |acc, t| acc | ct_eq(t.as_bytes(), h.as_bytes()))
    }

    pub fn add_token_hash(&mut self, hash: String) {
        if !self.tokens.contains(&hash) {
            self.tokens.push(hash);
        }
    }
}

pub fn hash_token(token: &str) -> String {
    let d = Sha256::digest(token.as_bytes());
    d.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub fn config_path() -> Result<PathBuf, String> {
    if let Some(p) = std::env::var_os("JANJA_HELPER_CONFIG") {
        return Ok(PathBuf::from(p));
    }
    let base = directories::BaseDirs::new().ok_or("não achei a pasta de configuração do usuário")?;
    Ok(base.config_dir().join("JanJa").join("helper.json"))
}

pub fn load(path: &std::path::Path) -> Result<Config, String> {
    match std::fs::read_to_string(path) {
        Ok(s) => {
            let mut cfg: Config =
                serde_json::from_str(&s).map_err(|e| format!("config corrompida em {}: {e}", path.display()))?;
            cfg.migrate_origins();
            Ok(cfg)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(e) => Err(format!("não consegui ler {}: {e}", path.display())),
    }
}

pub fn save(path: &std::path::Path, cfg: &Config) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("não consegui criar {}: {e}", dir.display()))?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| format!("não consegui gravar {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_check() {
        let mut c = Config::default();
        assert!(c.origin_allowed(Some("http://localhost:8787")));
        assert!(c.origin_allowed(Some("http://127.0.0.1:8787")));
        assert!(c.origin_allowed(Some("HTTP://LocalHost:8787/")));
        assert!(!c.origin_allowed(None));
        assert!(!c.origin_allowed(Some("")));
        assert!(!c.origin_allowed(Some("null")));
        assert!(!c.origin_allowed(Some("http://localhost:8788")));
        assert!(!c.origin_allowed(Some("https://localhost:8787")));
        assert!(!c.origin_allowed(Some("http://localhost:8787.evil.com")));
        assert!(!c.origin_allowed(Some("http://evil.com/http://localhost:8787")));
        assert!(!c.origin_allowed(Some("http://localhost:8787@evil.com")));
        assert_eq!(c.add_origin("https://janja.x.workers.dev/").unwrap(), "https://janja.x.workers.dev");
        assert!(c.origin_allowed(Some("https://janja.x.workers.dev")));
        assert!(!c.origin_allowed(Some("https://other.workers.dev")));
        // idempotente
        let n = c.origins.len();
        c.add_origin("https://janja.x.workers.dev").unwrap();
        assert_eq!(c.origins.len(), n);
        assert!(c.add_origin("janja.x.workers.dev").is_err());
        assert!(c.add_origin("https://a.b/caminho").is_err());
    }

    #[test]
    fn token_hash() {
        // SHA-256("abc")
        assert_eq!(hash_token("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        let mut c = Config::default();
        c.add_token_hash(hash_token("segredo"));
        assert!(c.token_valid("segredo"));
        assert!(!c.token_valid("segred0"));
        assert!(!c.token_valid(""));
        assert!(!Config::default().token_valid("segredo"));
    }

    #[test]
    fn roundtrip_and_defaults() {
        let dir = std::env::temp_dir().join(format!("janja-test-{}", std::process::id()));
        let p = dir.join("helper.json");
        assert_eq!(load(&p).unwrap(), Config::default());
        let mut c = Config::default();
        c.add_token_hash("aa".into());
        save(&p, &c).unwrap();
        assert_eq!(load(&p).unwrap(), c);
        std::fs::write(&p, "{}").unwrap();
        assert_eq!(load(&p).unwrap().origins.len(), DEFAULT_ORIGINS.len());
        // config antiga: o endereço aposentado sai, os oficiais entram, os extras ficam
        std::fs::write(&p, r#"{"origins":["https://janja.pvpswapedro123.workers.dev","https://outro.exemplo.dev"],"tokens":[]}"#).unwrap();
        let c = load(&p).unwrap();
        assert!(!c.origin_allowed(Some("https://janja.pvpswapedro123.workers.dev")));
        assert!(c.origin_allowed(Some("https://janja.spotlightre.workers.dev")));
        assert!(c.origin_allowed(Some("https://outro.exemplo.dev")));
        let _ = std::fs::remove_dir_all(dir);
    }
}
