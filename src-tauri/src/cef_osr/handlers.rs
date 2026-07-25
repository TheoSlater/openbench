//! CEF callback objects. Everything here is invoked by Chromium on the CEF UI
//! thread and must not block: each callback packs its payload and pushes it
//! down a Tauri channel to the frontend.

use cef::*;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::ipc::{Channel, InvokeResponseBody};

use super::browser::ViewState;
use super::frame::{encode_frame, BYTES_PER_PIXEL};

cef::wrap_render_handler! {
    pub struct OsrRenderHandler {
        view: ViewState,
        on_frame: Channel<InvokeResponseBody>,
    }

    impl RenderHandler {
        fn view_rect(&self, _browser: Option<&mut Browser>, rect: Option<&mut Rect>) {
            if let Some(rect) = rect {
                let (width, height) = self.view.size();
                rect.width = width;
                rect.height = height;
            }
        }

        fn screen_info(
            &self,
            _browser: Option<&mut Browser>,
            screen_info: Option<&mut ScreenInfo>,
        ) -> ::std::os::raw::c_int {
            if let Some(screen_info) = screen_info {
                screen_info.device_scale_factor = self.view.scale_factor();
                return 1;
            }
            0
        }

        fn on_paint(
            &self,
            _browser: Option<&mut Browser>,
            type_: PaintElementType,
            dirty_rects: Option<&[Rect]>,
            buffer: *const u8,
            width: ::std::os::raw::c_int,
            height: ::std::os::raw::c_int,
        ) {
            if type_ != PaintElementType::VIEW || buffer.is_null() || width <= 0 || height <= 0 {
                return;
            }
            let Some(byte_len) = (width as usize)
                .checked_mul(height as usize)
                .and_then(|pixels| pixels.checked_mul(BYTES_PER_PIXEL))
            else {
                return;
            };
            // SAFETY: CEF owns this BGRA buffer and guarantees width * height
            // * 4 readable bytes for this callback only. `encode_frame` copies
            // every selected byte before the callback returns.
            let pixels = unsafe { std::slice::from_raw_parts(buffer, byte_len) };
            let full_frame = [Rect { x: 0, y: 0, width, height }];
            let rects = if self.view.take_full_frame_pending() {
                &full_frame
            } else {
                dirty_rects.filter(|rects| !rects.is_empty()).unwrap_or(&full_frame)
            };
            let painted_at_ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_secs_f64() * 1_000.0)
                .unwrap_or_default();
            if let Ok(packet) = encode_frame(pixels, width, height, rects, painted_at_ms) {
                let _ = self.on_frame.send(InvokeResponseBody::Raw(packet));
            }
        }
    }
}

cef::wrap_display_handler! {
    pub struct OsrDisplayHandler {
        on_cursor: Channel<String>,
        on_address: Channel<String>,
    }

    impl DisplayHandler {
        fn on_cursor_change(
            &self,
            _browser: Option<&mut Browser>,
            _cursor: ::std::os::raw::c_ulong,
            type_: CursorType,
            _custom_cursor_info: Option<&CursorInfo>,
        ) -> ::std::os::raw::c_int {
            let _ = self.on_cursor.send(cursor_css(type_).to_string());
            1
        }

        fn on_address_change(
            &self,
            _browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            url: Option<&CefString>,
        ) {
            let is_main_frame = frame.is_some_and(|frame| frame.is_main() != 0);
            if let Some(url) = url.filter(|_| is_main_frame) {
                let _ = self.on_address.send(url.to_string());
            }
        }
    }
}

cef::wrap_client! {
    pub struct OsrClient {
        render_handler: RenderHandler,
        display_handler: DisplayHandler,
    }

    impl Client {
        fn render_handler(&self) -> Option<RenderHandler> {
            Some(self.render_handler.clone())
        }

        fn display_handler(&self) -> Option<DisplayHandler> {
            Some(self.display_handler.clone())
        }
    }
}

/// The canvas has no native cursor of its own, so Chromium's choice is
/// forwarded as a CSS `cursor` value for the frontend to apply.
fn cursor_css(cursor: CursorType) -> &'static str {
    match cursor {
        CursorType::HAND => "pointer",
        CursorType::IBEAM => "text",
        CursorType::CROSS => "crosshair",
        CursorType::WAIT => "wait",
        CursorType::PROGRESS => "progress",
        CursorType::MOVE => "move",
        CursorType::EASTRESIZE
        | CursorType::WESTRESIZE
        | CursorType::EASTWESTRESIZE
        | CursorType::COLUMNRESIZE => "ew-resize",
        CursorType::NORTHRESIZE
        | CursorType::SOUTHRESIZE
        | CursorType::NORTHSOUTHRESIZE
        | CursorType::ROWRESIZE => "ns-resize",
        CursorType::NORTHEASTRESIZE
        | CursorType::SOUTHWESTRESIZE
        | CursorType::NORTHEASTSOUTHWESTRESIZE => "nesw-resize",
        CursorType::NORTHWESTRESIZE
        | CursorType::SOUTHEASTRESIZE
        | CursorType::NORTHWESTSOUTHEASTRESIZE => "nwse-resize",
        CursorType::NOTALLOWED | CursorType::NODROP => "not-allowed",
        CursorType::GRAB => "grab",
        CursorType::GRABBING => "grabbing",
        CursorType::NONE => "none",
        _ => "default",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn common_cef_cursors_map_to_css() {
        assert_eq!(cursor_css(CursorType::HAND), "pointer");
        assert_eq!(cursor_css(CursorType::IBEAM), "text");
        assert_eq!(cursor_css(CursorType::NORTHSOUTHRESIZE), "ns-resize");
    }
}
