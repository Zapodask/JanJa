//! Parte dependente de sistema operacional. O alvo real é Windows; nos outros sistemas há
//! apenas um stub (não injeta nada) para desenvolvimento e testes.

#[cfg(windows)]
mod win;
#[cfg(windows)]
pub use win::*;

#[cfg(not(windows))]
mod stub;
#[cfg(not(windows))]
pub use stub::*;
