//! Wire format for painted frames.
//!
//! Only dirty rectangles are shipped, so a caret blink costs a few hundred
//! bytes instead of a full-surface copy. Layout, all little-endian:
//!
//! ```text
//! header: u32 version | u32 width | u32 height | u32 rect_count | f64 painted_at_ms
//! rects:  rect_count x (i32 x | i32 y | i32 width | i32 height)
//! pixels: each rect's BGRA rows, in rect order
//! ```
//!
//! `cefFrame.ts` decodes it; the two must change together. The main process
//! forwards these packets verbatim and never parses one.

use cef::Rect;

pub const FRAME_VERSION: u32 = 1;
pub const FRAME_HEADER_BYTES: usize = 24;
pub const RECT_HEADER_BYTES: usize = 16;
pub const BYTES_PER_PIXEL: usize = 4;

pub fn encode_frame(
    pixels: &[u8],
    width: i32,
    height: i32,
    dirty_rects: &[Rect],
    painted_at_ms: f64,
) -> Result<Vec<u8>, String> {
    let width_usize = usize::try_from(width).map_err(|_| "invalid CEF frame width")?;
    let height_usize = usize::try_from(height).map_err(|_| "invalid CEF frame height")?;
    let expected_len = width_usize
        .checked_mul(height_usize)
        .and_then(|value| value.checked_mul(BYTES_PER_PIXEL))
        .ok_or("CEF frame size overflow")?;
    if pixels.len() != expected_len || dirty_rects.is_empty() {
        return Err("invalid CEF frame buffer".to_string());
    }

    let mut pixel_bytes = 0usize;
    for rect in dirty_rects {
        if rect.x < 0
            || rect.y < 0
            || rect.width <= 0
            || rect.height <= 0
            || rect.x + rect.width > width
            || rect.y + rect.height > height
        {
            return Err("invalid CEF dirty rect".to_string());
        }
        pixel_bytes = pixel_bytes
            .checked_add(rect.width as usize * rect.height as usize * BYTES_PER_PIXEL)
            .ok_or("CEF dirty rect size overflow")?;
    }
    let rect_headers = dirty_rects
        .len()
        .checked_mul(RECT_HEADER_BYTES)
        .ok_or("CEF dirty rect header overflow")?;
    let capacity = FRAME_HEADER_BYTES
        .checked_add(rect_headers)
        .and_then(|value| value.checked_add(pixel_bytes))
        .ok_or("CEF frame packet overflow")?;
    let mut packet = Vec::with_capacity(capacity);
    packet.extend_from_slice(&FRAME_VERSION.to_le_bytes());
    packet.extend_from_slice(&(width as u32).to_le_bytes());
    packet.extend_from_slice(&(height as u32).to_le_bytes());
    packet.extend_from_slice(&(dirty_rects.len() as u32).to_le_bytes());
    packet.extend_from_slice(&painted_at_ms.to_le_bytes());
    for rect in dirty_rects {
        packet.extend_from_slice(&rect.x.to_le_bytes());
        packet.extend_from_slice(&rect.y.to_le_bytes());
        packet.extend_from_slice(&rect.width.to_le_bytes());
        packet.extend_from_slice(&rect.height.to_le_bytes());
    }
    let source_stride = width_usize * BYTES_PER_PIXEL;
    for rect in dirty_rects {
        let row_bytes = rect.width as usize * BYTES_PER_PIXEL;
        let first_row = rect.y as usize;
        let last_row = (rect.y + rect.height) as usize;
        // A full-width rect is already contiguous, which is the common case:
        // every resize forces one, and CEF reports one on most repaints. One
        // memcpy instead of 1,600 row copies at 2x.
        if row_bytes == source_stride {
            let start = first_row * source_stride;
            packet.extend_from_slice(&pixels[start..last_row * source_stride]);
            continue;
        }
        for row in first_row..last_row {
            let start = row * source_stride + rect.x as usize * BYTES_PER_PIXEL;
            packet.extend_from_slice(&pixels[start..start + row_bytes]);
        }
    }
    Ok(packet)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_packet_contains_only_dirty_rect_pixels() {
        let pixels = [
            0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
        ];
        let rect = Rect {
            x: 1,
            y: 0,
            width: 2,
            height: 2,
        };

        let packet = encode_frame(&pixels, 3, 2, &[rect], 1234.5).expect("valid frame");

        assert_eq!(packet.len(), 24 + 16 + 16);
        assert_eq!(
            &packet[40..],
            &[4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19, 20, 21, 22, 23]
        );
    }
}
