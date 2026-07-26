//! CEF callback objects. Everything here is invoked by Chromium on the CEF UI
//! thread and must not block: each callback packs its payload and writes one
//! framed message to the main process.

use cef::*;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::browser::ViewState;
use crate::frame::{encode_frame, BYTES_PER_PIXEL};
use crate::protocol::{BrowserId, NavState, Sink, Tag};

cef::wrap_render_handler! {
    pub struct OsrRenderHandler {
        view: ViewState,
        sink: Sink,
        id: BrowserId,
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
                self.sink.send(Tag::Frame, self.id, &packet);
            }
        }
    }
}

cef::wrap_display_handler! {
    pub struct OsrDisplayHandler {
        sink: Sink,
        id: BrowserId,
    }

    impl DisplayHandler {
        fn on_cursor_change(
            &self,
            _browser: Option<&mut Browser>,
            _cursor: CursorHandle,
            type_: CursorType,
            _custom_cursor_info: Option<&CursorInfo>,
        ) -> ::std::os::raw::c_int {
            self.sink.send(Tag::Cursor, self.id, cursor_css(type_).as_bytes());
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
                self.sink.send(Tag::Address, self.id, url.to_string().as_bytes());
            }
        }
    }
}

cef::wrap_load_handler! {
    pub struct OsrLoadHandler {
        sink: Sink,
        id: BrowserId,
    }

    impl LoadHandler {
        fn on_loading_state_change(
            &self,
            _browser: Option<&mut Browser>,
            is_loading: ::std::os::raw::c_int,
            can_go_back: ::std::os::raw::c_int,
            can_go_forward: ::std::os::raw::c_int,
        ) {
            let state = NavState {
                is_loading: is_loading != 0,
                can_go_back: can_go_back != 0,
                can_go_forward: can_go_forward != 0,
            };
            if let Ok(payload) = serde_json::to_vec(&state) {
                self.sink.send(Tag::NavState, self.id, &payload);
            }
        }
    }
}

cef::wrap_client! {
    pub struct OsrClient {
        render_handler: RenderHandler,
        display_handler: DisplayHandler,
        load_handler: LoadHandler,
    }

    impl Client {
        fn render_handler(&self) -> Option<RenderHandler> {
            Some(self.render_handler.clone())
        }

        fn display_handler(&self) -> Option<DisplayHandler> {
            Some(self.display_handler.clone())
        }

        fn load_handler(&self) -> Option<LoadHandler> {
            Some(self.load_handler.clone())
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
