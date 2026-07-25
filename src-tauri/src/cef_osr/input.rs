//! Frontend input events replayed onto the browser host.
//!
//! The canvas has no native input of its own, so `cefInput.ts` translates DOM
//! events into these and batches them per animation frame. Field names arrive
//! camelCase from the frontend; the `kind` tag selects the variant.

use cef::*;

use super::browser::with_host;

#[derive(serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CefMouseButton {
    Left,
    Middle,
    Right,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CefKeyEventType {
    RawKeyDown,
    KeyUp,
    Char,
}

#[derive(serde::Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum CefInputEvent {
    Focus {
        focused: bool,
    },
    MouseMove {
        x: i32,
        y: i32,
        modifiers: u32,
        mouse_leave: bool,
    },
    MouseClick {
        x: i32,
        y: i32,
        modifiers: u32,
        button: CefMouseButton,
        mouse_up: bool,
        click_count: u8,
    },
    MouseWheel {
        x: i32,
        y: i32,
        modifiers: u32,
        delta_x: i32,
        delta_y: i32,
    },
    Key {
        event_type: CefKeyEventType,
        modifiers: u32,
        windows_key_code: i32,
        native_key_code: i32,
        is_system_key: bool,
        character: u16,
        unmodified_character: u16,
    },
}

impl From<CefMouseButton> for MouseButtonType {
    fn from(button: CefMouseButton) -> Self {
        match button {
            CefMouseButton::Left => MouseButtonType::LEFT,
            CefMouseButton::Middle => MouseButtonType::MIDDLE,
            CefMouseButton::Right => MouseButtonType::RIGHT,
        }
    }
}

impl From<CefKeyEventType> for KeyEventType {
    fn from(event_type: CefKeyEventType) -> Self {
        match event_type {
            CefKeyEventType::RawKeyDown => KeyEventType::RAWKEYDOWN,
            CefKeyEventType::KeyUp => KeyEventType::KEYUP,
            CefKeyEventType::Char => KeyEventType::CHAR,
        }
    }
}

/// UI thread only.
pub(super) fn dispatch_input(events: Vec<CefInputEvent>) -> Result<(), String> {
    with_host(|host| {
        for event in events {
            dispatch_event(host, event)?;
        }
        Ok(())
    })?
}

fn dispatch_event(host: &BrowserHost, event: CefInputEvent) -> Result<(), String> {
    match event {
        CefInputEvent::Focus { focused } => host.set_focus(i32::from(focused)),
        CefInputEvent::MouseMove {
            x,
            y,
            modifiers,
            mouse_leave,
        } => host.send_mouse_move_event(
            Some(&MouseEvent { x, y, modifiers }),
            i32::from(mouse_leave),
        ),
        CefInputEvent::MouseClick {
            x,
            y,
            modifiers,
            button,
            mouse_up,
            click_count,
        } => {
            if !(1..=3).contains(&click_count) {
                return Err("CEF click count must be between 1 and 3.".to_string());
            }
            host.send_mouse_click_event(
                Some(&MouseEvent { x, y, modifiers }),
                button.into(),
                i32::from(mouse_up),
                i32::from(click_count),
            );
        }
        CefInputEvent::MouseWheel {
            x,
            y,
            modifiers,
            delta_x,
            delta_y,
        } => host.send_mouse_wheel_event(Some(&MouseEvent { x, y, modifiers }), delta_x, delta_y),
        CefInputEvent::Key {
            event_type,
            modifiers,
            windows_key_code,
            native_key_code,
            is_system_key,
            character,
            unmodified_character,
        } => host.send_key_event(Some(&KeyEvent {
            type_: event_type.into(),
            modifiers,
            windows_key_code,
            native_key_code,
            is_system_key: i32::from(is_system_key),
            character,
            unmodified_character,
            ..Default::default()
        })),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_event_deserializes_camel_case_frontend_fields() {
        let event: CefInputEvent = serde_json::from_value(serde_json::json!({
            "kind": "mouse_click",
            "x": 12,
            "y": 34,
            "modifiers": 16,
            "button": "left",
            "mouseUp": false,
            "clickCount": 2
        }))
        .expect("valid CEF input event");

        assert!(matches!(
            event,
            CefInputEvent::MouseClick {
                x: 12,
                y: 34,
                click_count: 2,
                ..
            }
        ));
    }
}
