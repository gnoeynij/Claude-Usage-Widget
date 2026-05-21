//! Runtime tray/taskbar icon — Anthropic pixel mark on threshold-color background.
//!
//! W2 변형(픽셀 + bar)은 작은 trayicon 사이즈에서 bar가 거의 안 보였음.
//! 더 명확한 신호 위해 *배경 색* 자체를 threshold(녹색/주황/빨강)로 칠하고
//! 픽셀 크랩은 흰색 tint로 overlay. 16-24px 사이즈에서도 색은 분명히 인지됨.
//!
//! Source PNG는 `src/assets/claude-header.png` (256×160), 컴파일 타임 embed.
//! 흰색 tint는 직접 R/G/B 를 255로 치환하고 alpha 만 보존하는 방식
//! (tiny-skia용 ColorMatrix가 없으므로 blit 시점에 한다).

use image::imageops::FilterType;
use tiny_skia::{Color, FillRule, Paint, PathBuilder, Pixmap, Transform};

const SIZE: u32 = 128;

/// Anthropic pixel mark, embedded so the tray icon ships in the .exe.
const CRAB_PNG: &[u8] = include_bytes!("../../src/assets/claude-header.png");

pub fn render_gauge_rgba(pct: f64) -> (Vec<u8>, u32, u32) {
    let bytes = if pct < 0.0 {
        render_error()
    } else {
        render_pixel_bg(pct)
    };
    (bytes, SIZE, SIZE)
}

fn render_pixel_bg(pct: f64) -> Vec<u8> {
    let pct = pct.clamp(0.0, 100.0) as f32;
    let mut pixmap = Pixmap::new(SIZE, SIZE).expect("pixmap alloc");

    // Background — threshold color rounded square
    let bg_path = rounded_rect_path(0.0, 0.0, SIZE as f32, SIZE as f32, 25.0);
    let mut bg_paint = Paint::default();
    bg_paint.set_color(threshold_color(pct));
    bg_paint.anti_alias = true;
    pixmap.fill_path(&bg_path, &bg_paint, FillRule::Winding, Transform::identity(), None);

    // Crab — white tinted, large, centered
    let crab_w = 90u32;
    let crab_h = (crab_w as f32 * 160.0 / 256.0) as u32; // preserve 256:160 aspect
    let crab_x = (SIZE - crab_w) / 2;
    let crab_y = (SIZE - crab_h) / 2;
    blit_png_tinted(&mut pixmap, CRAB_PNG, crab_x, crab_y, crab_w, crab_h, 255, 255, 255, 255);

    pixmap.take()
}

fn render_error() -> Vec<u8> {
    let mut pixmap = Pixmap::new(SIZE, SIZE).expect("pixmap alloc");

    // Neutral grey background — colored signal absence = "no data"
    let bg_path = rounded_rect_path(0.0, 0.0, SIZE as f32, SIZE as f32, 25.0);
    let mut bg_paint = Paint::default();
    bg_paint.set_color(Color::from_rgba8(140, 140, 150, 255));
    bg_paint.anti_alias = true;
    pixmap.fill_path(&bg_path, &bg_paint, FillRule::Winding, Transform::identity(), None);

    // Dimmed white crab
    let crab_w = 90u32;
    let crab_h = (crab_w as f32 * 160.0 / 256.0) as u32;
    let crab_x = (SIZE - crab_w) / 2;
    let crab_y = (SIZE - crab_h) / 2;
    blit_png_tinted(&mut pixmap, CRAB_PNG, crab_x, crab_y, crab_w, crab_h, 255, 255, 255, 180);

    pixmap.take()
}

fn rounded_rect_path(x: f32, y: f32, w: f32, h: f32, r: f32) -> tiny_skia::Path {
    let mut pb = PathBuilder::new();
    pb.move_to(x + r, y);
    pb.line_to(x + w - r, y);
    pb.quad_to(x + w, y, x + w, y + r);
    pb.line_to(x + w, y + h - r);
    pb.quad_to(x + w, y + h, x + w - r, y + h);
    pb.line_to(x + r, y + h);
    pb.quad_to(x, y + h, x, y + h - r);
    pb.line_to(x, y + r);
    pb.quad_to(x, y, x + r, y);
    pb.close();
    pb.finish().expect("rounded rect path")
}

/// Decode PNG, resize with Lanczos3, *tint* RGB to (tr, tg, tb), preserve alpha
/// (multiplied by `alpha_mult/255`), premultiply, and blit into pixmap.
/// tiny-skia stores premultiplied RGBA; image crate returns straight RGBA.
#[allow(clippy::too_many_arguments)]
fn blit_png_tinted(
    pixmap: &mut Pixmap,
    png: &[u8],
    dx: u32,
    dy: u32,
    w: u32,
    h: u32,
    tr: u8,
    tg: u8,
    tb: u8,
    alpha_mult: u8,
) {
    let img = match image::load_from_memory_with_format(png, image::ImageFormat::Png) {
        Ok(i) => i,
        Err(_) => return,
    };
    let resized = img.resize_exact(w, h, FilterType::Lanczos3);
    let rgba_img = resized.to_rgba8();
    let (iw, ih) = rgba_img.dimensions();
    let rgba = rgba_img.as_raw();
    let canvas_w = pixmap.width();
    let canvas_h = pixmap.height();
    let canvas_bytes = pixmap.data_mut();
    for y in 0..ih {
        for x in 0..iw {
            let src_idx = ((y * iw + x) * 4) as usize;
            let src_a = rgba[src_idx + 3];
            if src_a == 0 {
                continue; // fully transparent — leave bg alone
            }
            // Compose with tint over existing canvas pixel (source-over alpha blend)
            let a = ((src_a as u16) * (alpha_mult as u16) / 255) as u8;
            // Premultiplied tint
            let r = ((tr as u16) * (a as u16) / 255) as u8;
            let g = ((tg as u16) * (a as u16) / 255) as u8;
            let b = ((tb as u16) * (a as u16) / 255) as u8;
            let dx_p = dx + x;
            let dy_p = dy + y;
            if dx_p >= canvas_w || dy_p >= canvas_h {
                continue;
            }
            let dst_idx = ((dy_p * canvas_w + dx_p) * 4) as usize;
            if dst_idx + 4 > canvas_bytes.len() {
                continue;
            }
            // Source-over composite: out = src + dst * (1 - src_a)
            let inv_a = 255 - a;
            let dst_r = canvas_bytes[dst_idx];
            let dst_g = canvas_bytes[dst_idx + 1];
            let dst_b = canvas_bytes[dst_idx + 2];
            let dst_a = canvas_bytes[dst_idx + 3];
            canvas_bytes[dst_idx]     = r.saturating_add(((dst_r as u16) * (inv_a as u16) / 255) as u8);
            canvas_bytes[dst_idx + 1] = g.saturating_add(((dst_g as u16) * (inv_a as u16) / 255) as u8);
            canvas_bytes[dst_idx + 2] = b.saturating_add(((dst_b as u16) * (inv_a as u16) / 255) as u8);
            canvas_bytes[dst_idx + 3] = a.saturating_add(((dst_a as u16) * (inv_a as u16) / 255) as u8);
        }
    }
}

/// Match the in-app Donut/CapsuleProgress threshold (Apple stoplight).
fn threshold_color(pct: f32) -> Color {
    if pct >= 80.0 {
        Color::from_rgba8(0xff, 0x45, 0x3a, 255)
    } else if pct >= 50.0 {
        Color::from_rgba8(0xff, 0x9f, 0x0a, 255)
    } else {
        Color::from_rgba8(0x34, 0xc7, 0x59, 255)
    }
}
