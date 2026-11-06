//! Windows: SendInput, EnumDisplayMonitors, RegisterHotKey + loop de mensagens.

use crate::engine::{Button, Injector, Monitor};
use crate::keymap::Key;
use std::ptr::{null, null_mut};
use std::sync::OnceLock;
use windows_sys::Win32::Foundation::{LPARAM, RECT};
use windows_sys::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO};
use windows_sys::Win32::System::Console::{SetConsoleCtrlHandler, SetConsoleTitleW};
use windows_sys::Win32::UI::HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
use windows_sys::Win32::UI::WindowsAndMessaging::{GetMessageW, SetCursorPos, MSG, WM_HOTKEY};
use windows_sys::core::BOOL;

pub const IS_STUB: bool = false;
const HOTKEY_ID: i32 = 0x4A41; // "JA"
const MONITORINFOF_PRIMARY: u32 = 1;

/// Pixels físicos: sem isto o Windows "virtualiza" coordenadas em telas com escala > 100%.
pub fn init() {
    unsafe {
        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
}

pub fn set_title(title: &str) {
    let w: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        SetConsoleTitleW(w.as_ptr());
    }
}

pub struct WinInjector;

unsafe extern "system" fn enum_cb(hmon: HMONITOR, _hdc: HDC, _rc: *mut RECT, lparam: LPARAM) -> BOOL {
    let list = unsafe { &mut *(lparam as *mut Vec<Monitor>) };
    let mut mi = MONITORINFO::default();
    mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
    if unsafe { GetMonitorInfoW(hmon, &mut mi) } != 0 {
        let r = mi.rcMonitor;
        list.push(Monitor {
            id: list.len() as u32,
            x: r.left,
            y: r.top,
            w: r.right - r.left,
            h: r.bottom - r.top,
            primary: mi.dwFlags & MONITORINFOF_PRIMARY != 0,
        });
    }
    1 // continuar
}

fn send_mouse(flags: u32, data: u32) {
    let input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 { mi: MOUSEINPUT { dx: 0, dy: 0, mouseData: data, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    };
    unsafe {
        SendInput(1, &input, std::mem::size_of::<INPUT>() as i32);
    }
}

impl Injector for WinInjector {
    fn monitors(&self) -> Vec<Monitor> {
        let mut list: Vec<Monitor> = Vec::new();
        unsafe {
            EnumDisplayMonitors(null_mut(), null(), Some(enum_cb), &mut list as *mut Vec<Monitor> as LPARAM);
        }
        list
    }

    fn move_to(&mut self, x: i32, y: i32) {
        unsafe {
            SetCursorPos(x, y);
        }
    }

    fn button(&mut self, b: Button, down: bool) {
        let f = match (b, down) {
            (Button::Left, true) => MOUSEEVENTF_LEFTDOWN,
            (Button::Left, false) => MOUSEEVENTF_LEFTUP,
            (Button::Middle, true) => MOUSEEVENTF_MIDDLEDOWN,
            (Button::Middle, false) => MOUSEEVENTF_MIDDLEUP,
            (Button::Right, true) => MOUSEEVENTF_RIGHTDOWN,
            (Button::Right, false) => MOUSEEVENTF_RIGHTUP,
        };
        send_mouse(f, 0);
    }

    fn wheel(&mut self, dx: i32, dy: i32) {
        // Navegador: deltaY > 0 = para baixo. Windows: positivo = para cima/longe do usuário.
        if dy != 0 {
            send_mouse(MOUSEEVENTF_WHEEL, (-dy * 120) as u32);
        }
        // deltaX > 0 = direita; HWHEEL positivo = direita.
        if dx != 0 {
            send_mouse(MOUSEEVENTF_HWHEEL, (dx * 120) as u32);
        }
    }

    fn key(&mut self, k: Key, down: bool) {
        let mut flags = KEYEVENTF_SCANCODE;
        if k.extended {
            flags |= KEYEVENTF_EXTENDEDKEY;
        }
        if !down {
            flags |= KEYEVENTF_KEYUP;
        }
        let input = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: 0, wScan: k.scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
        };
        unsafe {
            SendInput(1, &input, std::mem::size_of::<INPUT>() as i32);
        }
    }
}

pub fn injector() -> Box<dyn Injector> {
    Box::new(WinInjector)
}

/// Ctrl+Alt+Shift+P global. Deve ser chamado na mesma thread que roda `run_loop`.
pub fn register_panic_hotkey() -> Result<(), String> {
    let ok = unsafe { RegisterHotKey(null_mut(), HOTKEY_ID, MOD_CONTROL | MOD_ALT | MOD_SHIFT | MOD_NOREPEAT, b'P' as u32) };
    if ok == 0 {
        Err("não consegui registrar Ctrl+Alt+Shift+P (outro programa já usa?)".into())
    } else {
        Ok(())
    }
}

static EXIT_HOOK: OnceLock<Box<dyn Fn() + Send + Sync>> = OnceLock::new();

unsafe extern "system" fn ctrl_handler(_kind: u32) -> BOOL {
    if let Some(f) = EXIT_HOOK.get() {
        f(); // solta teclas/botões antes de o processo morrer
    }
    0 // deixa o tratamento padrão encerrar o processo
}

pub fn install_exit_hook(f: Box<dyn Fn() + Send + Sync>) {
    if EXIT_HOOK.set(f).is_ok() {
        unsafe {
            SetConsoleCtrlHandler(Some(ctrl_handler), 1);
        }
    }
}

/// Loop de mensagens da thread principal (necessário para WM_HOTKEY).
pub fn run_loop(on_panic: impl Fn()) {
    let mut msg = MSG::default();
    loop {
        let r = unsafe { GetMessageW(&mut msg, null_mut(), 0, 0) };
        if r <= 0 {
            break; // WM_QUIT (0) ou erro (-1)
        }
        if msg.message == WM_HOTKEY && msg.wParam == HOTKEY_ID as usize {
            on_panic();
        }
    }
}
