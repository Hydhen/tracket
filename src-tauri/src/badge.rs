//! The red dot on the app's icon in the taskbar, which says a timer is running.
//!
//! It is the taskbar's "overlay icon": Windows only, so elsewhere this does nothing.

use tauri::WebviewWindow;
use tauri::image::Image;

use crate::error::{AppError, Result};

/// The dot's picture is this many pixels wide and tall (the taskbar shrinks it to the corner of the icon).
const SIZE: u32 = 32;
const RED: [u8; 3] = [239, 68, 68];
const RADIUS: f32 = 10.0;

/// How much of the pixel at `(x, y)` is inside a circle of `radius` around the middle: 1 inside, 0 outside, and
/// in between along the edge, which smooths it.
fn coverage(x: u32, y: u32, radius: f32) -> f32 {
    let middle = SIZE as f32 / 2.0;
    let distance = ((x as f32 + 0.5 - middle).powi(2) + (y as f32 + 0.5 - middle).powi(2)).sqrt();
    (radius - distance + 0.5).clamp(0.0, 1.0)
}

/// The dot as RGBA pixels: red, with a smooth edge.
fn dot_pixels() -> Vec<u8> {
    let mut pixels = Vec::with_capacity((SIZE * SIZE * 4) as usize);
    for y in 0..SIZE {
        for x in 0..SIZE {
            pixels.extend_from_slice(&RED);
            pixels.push((coverage(x, y, RADIUS) * 255.0).round() as u8);
        }
    }
    pixels
}

/// Shows the dot on the taskbar icon, or takes it away.
#[tauri::command]
pub fn set_timer_badge(window: WebviewWindow, running: bool) -> Result<()> {
    #[cfg(windows)]
    {
        let icon = running.then(|| Image::new_owned(dot_pixels(), SIZE, SIZE));
        window.set_overlay_icon(icon).map_err(|e| {
            AppError::new("unexpected", format!("Couldn't change the taskbar icon: {e}"))
        })?;
    }
    #[cfg(not(windows))]
    let _ = (window, running, dot_pixels, Image::new_owned);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{SIZE, dot_pixels};

    fn pixel(pixels: &[u8], x: u32, y: u32) -> &[u8] {
        let at = ((y * SIZE + x) * 4) as usize;
        &pixels[at..at + 4]
    }

    #[test]
    fn is_a_red_dot_in_a_see_through_corner() {
        let pixels = dot_pixels();
        assert_eq!(pixels.len(), (SIZE * SIZE * 4) as usize);
        // The middle is solid red, and so is its edge
        assert_eq!(pixel(&pixels, SIZE / 2, SIZE / 2), [239, 68, 68, 255]);
        assert_eq!(pixel(&pixels, SIZE / 2, 7), [239, 68, 68, 255]);
        // The corners are see-through
        assert_eq!(pixel(&pixels, 0, 0)[3], 0);
        // Nothing but red is drawn
        assert!(pixels.chunks(4).all(|p| p[..3] == [239, 68, 68]));
    }
}
