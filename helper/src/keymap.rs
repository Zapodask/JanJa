//! KeyboardEvent.code (posição física) -> scancode set 1 (+ flag estendida).
//! Injetamos por scancode, então o layout (US/ABNT2) do PC controlado decide o caractere.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Key {
    pub scan: u16,
    pub extended: bool,
}

const fn k(scan: u16) -> Option<Key> {
    Some(Key { scan, extended: false })
}
const fn e(scan: u16) -> Option<Key> {
    Some(Key { scan, extended: true })
}

pub fn lookup(code: &str) -> Option<Key> {
    // Letras e dígitos por regra, o resto por tabela.
    if let Some(l) = code.strip_prefix("Key") {
        let b = l.as_bytes();
        if b.len() == 1 && b[0].is_ascii_uppercase() {
            return k(match b[0] {
                b'Q' => 0x10, b'W' => 0x11, b'E' => 0x12, b'R' => 0x13, b'T' => 0x14,
                b'Y' => 0x15, b'U' => 0x16, b'I' => 0x17, b'O' => 0x18, b'P' => 0x19,
                b'A' => 0x1E, b'S' => 0x1F, b'D' => 0x20, b'F' => 0x21, b'G' => 0x22,
                b'H' => 0x23, b'J' => 0x24, b'K' => 0x25, b'L' => 0x26,
                b'Z' => 0x2C, b'X' => 0x2D, b'C' => 0x2E, b'V' => 0x2F, b'B' => 0x30,
                b'N' => 0x31, _ => 0x32, // M
            });
        }
        return None;
    }
    if let Some(d) = code.strip_prefix("Digit") {
        return match d {
            "1" => k(0x02), "2" => k(0x03), "3" => k(0x04), "4" => k(0x05), "5" => k(0x06),
            "6" => k(0x07), "7" => k(0x08), "8" => k(0x09), "9" => k(0x0A), "0" => k(0x0B),
            _ => None,
        };
    }
    if let Some(n) = code.strip_prefix('F') {
        if let Ok(i) = n.parse::<u16>() {
            return match i {
                1..=10 => k(0x3A + i),
                11 => k(0x57),
                12 => k(0x58),
                _ => None,
            };
        }
    }
    match code {
        "Escape" => k(0x01),
        "Minus" => k(0x0C),
        "Equal" => k(0x0D),
        "Backspace" => k(0x0E),
        "Tab" => k(0x0F),
        "BracketLeft" => k(0x1A),
        "BracketRight" => k(0x1B),
        "Enter" => k(0x1C),
        "ControlLeft" => k(0x1D),
        "Semicolon" => k(0x27),
        "Quote" => k(0x28),
        "Backquote" => k(0x29),
        "ShiftLeft" => k(0x2A),
        "Backslash" => k(0x2B),
        "Comma" => k(0x33),
        "Period" => k(0x34),
        "Slash" => k(0x35),
        "ShiftRight" => k(0x36),
        "NumpadMultiply" => k(0x37),
        "AltLeft" => k(0x38),
        "Space" => k(0x39),
        "CapsLock" => k(0x3A),
        "NumLock" => k(0x45),
        "ScrollLock" => k(0x46),
        "Numpad7" => k(0x47),
        "Numpad8" => k(0x48),
        "Numpad9" => k(0x49),
        "NumpadSubtract" => k(0x4A),
        "Numpad4" => k(0x4B),
        "Numpad5" => k(0x4C),
        "Numpad6" => k(0x4D),
        "NumpadAdd" => k(0x4E),
        "Numpad1" => k(0x4F),
        "Numpad2" => k(0x50),
        "Numpad3" => k(0x51),
        "Numpad0" => k(0x52),
        "NumpadDecimal" => k(0x53),
        "IntlBackslash" => k(0x56),
        "IntlRo" => k(0x73),        // tecla / ? do ABNT2
        "NumpadComma" => k(0x7E),   // vírgula do numpad ABNT2
        "NumpadEnter" => e(0x1C),
        "ControlRight" => e(0x1D),
        "NumpadDivide" => e(0x35),
        "PrintScreen" => e(0x37),
        "AltRight" => e(0x38),
        "Home" => e(0x47),
        "ArrowUp" => e(0x48),
        "PageUp" => e(0x49),
        "ArrowLeft" => e(0x4B),
        "ArrowRight" => e(0x4D),
        "End" => e(0x4F),
        "ArrowDown" => e(0x50),
        "PageDown" => e(0x51),
        "Insert" => e(0x52),
        "Delete" => e(0x53),
        "MetaLeft" | "OSLeft" => e(0x5B),
        "MetaRight" | "OSRight" => e(0x5C),
        "ContextMenu" => e(0x5D),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn letters_digits_fkeys() {
        assert_eq!(lookup("KeyA"), k(0x1E));
        assert_eq!(lookup("KeyM"), k(0x32));
        assert_eq!(lookup("KeyZ"), k(0x2C));
        assert_eq!(lookup("Digit0"), k(0x0B));
        assert_eq!(lookup("Digit1"), k(0x02));
        assert_eq!(lookup("F1"), k(0x3B));
        assert_eq!(lookup("F10"), k(0x44));
        assert_eq!(lookup("F11"), k(0x57));
        assert_eq!(lookup("F12"), k(0x58));
    }

    #[test]
    fn extended_and_specials() {
        assert_eq!(lookup("ArrowLeft"), e(0x4B));
        assert_eq!(lookup("NumpadEnter"), e(0x1C));
        assert_eq!(lookup("Enter"), k(0x1C));
        assert_eq!(lookup("ControlRight"), e(0x1D));
        assert_eq!(lookup("MetaLeft"), e(0x5B));
        assert_eq!(lookup("IntlRo"), k(0x73));
        assert_eq!(lookup("Numpad5"), k(0x4C));
    }

    #[test]
    fn unknown_ignored() {
        for c in ["", "Key", "KeyAB", "Keya", "F0", "F13", "Digit10", "Bogus", "Lang1", "Fx"] {
            assert_eq!(lookup(c), None, "{c}");
        }
    }

    #[test]
    fn no_duplicate_scancodes() {
        let mut codes: Vec<String> = ('A'..='Z').map(|c| format!("Key{c}")).collect();
        codes.extend((0..=9).map(|d| format!("Digit{d}")));
        codes.extend((1..=12).map(|d| format!("F{d}")));
        codes.extend(
            "Escape Minus Equal Backspace Tab BracketLeft BracketRight Enter ControlLeft Semicolon Quote Backquote ShiftLeft Backslash Comma Period Slash ShiftRight NumpadMultiply AltLeft Space CapsLock NumLock ScrollLock Numpad0 Numpad1 Numpad2 Numpad3 Numpad4 Numpad5 Numpad6 Numpad7 Numpad8 Numpad9 NumpadSubtract NumpadAdd NumpadDecimal IntlBackslash IntlRo NumpadComma NumpadEnter ControlRight NumpadDivide PrintScreen AltRight Home ArrowUp PageUp ArrowLeft ArrowRight End ArrowDown PageDown Insert Delete MetaLeft MetaRight ContextMenu"
                .split(' ')
                .map(String::from),
        );
        let mut seen = std::collections::HashSet::new();
        for c in codes {
            let key = lookup(&c).unwrap_or_else(|| panic!("faltou {c}"));
            assert!(seen.insert(key), "duplicado: {c}");
        }
    }
}
