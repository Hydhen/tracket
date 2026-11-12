//! The mini mode: the window shrinks to a small pill that stays on top of the other windows (the
//! timer, see `MiniNotch` in the UI), and goes back to what it was.
//!
//! Done here rather than from the page so the steps happen together and in order, and so the
//! window's old place and size are kept next to the window, not in the page's state.

use std::fmt::Display;
use std::sync::Mutex;

use tauri::{
    LogicalSize, PhysicalPosition, PhysicalSize, Size, State, Theme, WebviewWindow, window::Color,
};

use crate::error::{AppError, Result};

/// The pill's window, in logical pixels: the pill plus a little room around it.
const MINI_SIZE: (f64, f64) = (184.0, 40.0);
/// How far below the top edge of the screen the pill sits.
const TOP_GAP: f64 = 8.0;
/// The window's smallest size when it isn't mini (the same as in tauri.conf.json).
const NORMAL_MIN_SIZE: (f64, f64) = (720.0, 480.0);

/// Where the window was before it became a pill.
struct Saved {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    maximized: bool,
}

#[derive(Default)]
pub struct MiniMode(Mutex<Option<Saved>>);

fn failed(e: impl Display) -> AppError {
    AppError::new("unexpected", format!("Couldn't change the window: {e}"))
}

/// The app's background for the system theme: what the webview shows before the page paints.
pub fn app_background(window: &WebviewWindow) -> Color {
    match window.theme() {
        Ok(Theme::Dark) => Color(25, 25, 25, 255),
        _ => Color(255, 255, 255, 255),
    }
}

/// Shrinks the window to the pill, at the top middle of the screen it is on.
#[tauri::command]
pub fn enter_mini(window: WebviewWindow, state: State<'_, MiniMode>) -> Result<()> {
    let mut saved = state.0.lock().map_err(failed)?;
    if saved.is_some() {
        return Ok(());
    }

    // Unmaximized first, so what is saved is the window's own place and size
    let maximized = window.is_maximized().map_err(failed)?;
    if maximized {
        window.unmaximize().map_err(failed)?;
    }
    *saved = Some(Saved {
        position: window.outer_position().map_err(failed)?,
        size: window.outer_size().map_err(failed)?,
        maximized,
    });

    window.set_min_size(None::<Size>).map_err(failed)?;
    window
        .set_size(LogicalSize::new(MINI_SIZE.0, MINI_SIZE.1))
        .map_err(failed)?;
    window.set_resizable(false).map_err(failed)?;
    // The pill is round: the window around it has to be see-through and without a shadow
    window.set_shadow(false).map_err(failed)?;
    window
        .set_background_color(Some(Color(0, 0, 0, 0)))
        .map_err(failed)?;
    window.set_always_on_top(true).map_err(failed)?;

    if let Some(monitor) = window.current_monitor().map_err(failed)? {
        let size = window.outer_size().map_err(failed)?;
        let x = monitor.position().x + (monitor.size().width as i32 - size.width as i32) / 2;
        let y = monitor.position().y + (TOP_GAP * monitor.scale_factor()) as i32;
        window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(failed)?;
    }
    Ok(())
}

/// Puts the window back where and as big as it was.
#[tauri::command]
pub fn leave_mini(window: WebviewWindow, state: State<'_, MiniMode>) -> Result<()> {
    let Some(saved) = state.0.lock().map_err(failed)?.take() else {
        return Ok(());
    };

    window.set_always_on_top(false).map_err(failed)?;
    window
        .set_background_color(Some(app_background(&window)))
        .map_err(failed)?;
    window.set_shadow(true).map_err(failed)?;
    window.set_resizable(true).map_err(failed)?;
    window
        .set_min_size(Some(LogicalSize::new(
            NORMAL_MIN_SIZE.0,
            NORMAL_MIN_SIZE.1,
        )))
        .map_err(failed)?;
    window.set_size(saved.size).map_err(failed)?;
    window.set_position(saved.position).map_err(failed)?;
    if saved.maximized {
        window.maximize().map_err(failed)?;
    }
    Ok(())
}
