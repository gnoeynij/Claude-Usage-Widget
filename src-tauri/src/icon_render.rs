//! Runtime tray/taskbar icon — Anthropic pixel mark on radial-halo background.
//!
//! 변천:
//! - W2(픽셀 + 하단 bar) → 작은 사이즈에서 bar가 사라짐
//! - 픽셀 + rounded-square fill → "네이버 N 로고" 같다는 피드백
//! - 픽셀 + radial halo (현재) → 부드러운 발광체 + brand identity
//!
//! 배경 색 자체가 threshold 신호(녹/주/적, Apple stoplight). 외곽은 alpha 0으로
//! fade out 되어 사각형 윤곽 없이 자연스레 OS 합성과 어우러짐.
//!
//! Source PNG는 `src/assets/claude-header.png` (256×160), 컴파일 타임 embed.

use image::imageops::FilterType;
use tiny_skia::{
    Color, FillRule, GradientStop, Paint, PathBuilder, Pixmap, Point, RadialGradient, Rect,
    SpreadMode, Transform,
};

const SIZE: u32 = 128;

/// Anthropic pixel mark, embedded so the tray icon ships in the .exe.
const CRAB_PNG: &[u8] = include_bytes!("../../src/assets/claude-header.png");

pub fn render_gauge_rgba(pct: f64) -> (Vec<u8>, u32, u32) {
    let bytes = if pct < 0.0 {
        render_error()
    } else {
        render_pixel_halo(pct)
    };
    (bytes, SIZE, SIZE)
}

fn render_pixel_halo(pct: f64) -> Vec<u8> {
    let pct = pct.clamp(0.0, 100.0) as f32;
    let mut pixmap = Pixmap::new(SIZE, SIZE).expect("pixmap alloc");

    let (r, g, b) = threshold_rgb(pct);
    draw_halo(&mut pixmap, r, g, b, 255);

    let crab_w = 90u32;
    let crab_h = (crab_w as f32 * 160.0 / 256.0) as u32;
    let crab_x = (SIZE - crab_w) / 2;
    let crab_y = (SIZE - crab_h) / 2;
    blit_png_tinted(&mut pixmap, CRAB_PNG, crab_x, crab_y, crab_w, crab_h, 255, 255, 255, 255);

    pixmap.take()
}

fn render_error() -> Vec<u8> {
    let mut pixmap = Pixmap::new(SIZE, SIZE).expect("pixmap alloc");
    // Neutral grey halo — 색 신호 부재 = "데이터 없음"
    draw_halo(&mut pixmap, 140, 140, 150, 220);

    let crab_w = 90u32;
    let crab_h = (crab_w as f32 * 160.0 / 256.0) as u32;
    let crab_x = (SIZE - crab_w) / 2;
    let crab_y = (SIZE - crab_h) / 2;
    blit_png_tinted(&mut pixmap, CRAB_PNG, crab_x, crab_y, crab_w, crab_h, 255, 255, 255, 180);

    pixmap.take()
}

/// Radial halo: solid core fading to transparent at edges. Stops shape the
/// "발광체" feel — inner mass stays opaque, fade only in outer 45% of radius.
/// 외곽 alpha 0 으로 사각형 윤곽 없이 OS 합성과 자연스럽게 어우러짐.
fn draw_halo(pixmap: &mut Pixmap, r: u8, g: u8, b: u8, core_alpha: u8) {
    let cx = SIZE as f32 / 2.0;
    let cy = SIZE as f32 / 2.0;
    let halo_r = 62.0;

    let mid_alpha = core_alpha / 4;
    let stops = vec![
        GradientStop::new(0.0, Color::from_rgba8(r, g, b, core_alpha)),
        GradientStop::new(0.55, Color::from_rgba8(r, g, b, core_alpha)),
        GradientStop::new(0.85, Color::from_rgba8(r, g, b, mid_alpha)),
        GradientStop::new(1.0, Color::from_rgba8(r, g, b, 0)),
    ];
    let shader = RadialGradient::new(
        Point::from_xy(cx, cy),
        Point::from_xy(cx, cy),
        halo_r,
        stops,
        SpreadMode::Pad,
        Transform::identity(),
    )
    .expect("radial gradient");

    let mut paint = Paint::default();
    paint.shader = shader;
    paint.anti_alias = true;

    let mut pb = PathBuilder::new();
    pb.push_rect(Rect::from_xywh(0.0, 0.0, SIZE as f32, SIZE as f32).expect("rect"));
    let rect_path = pb.finish().expect("rect path");
    pixmap.fill_path(&rect_path, &paint, FillRule::Winding, Transform::identity(), None);
}

/// Decode PNG, resize with Lanczos3, *tint* RGB to (tr, tg, tb), preserve alpha
/// (multiplied by `alpha_mult/255`), premultiply, and source-over composite
/// into pixmap. tiny-skia stores premultiplied RGBA; image crate returns
/// straight RGBA, so we both premultiply *and* blend manually.
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
                continue;
            }
            let a = ((src_a as u16) * (alpha_mult as u16) / 255) as u8;
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
fn threshold_rgb(pct: f32) -> (u8, u8, u8) {
    if pct >= 80.0 {
        (0xff, 0x45, 0x3a)
    } else if pct >= 50.0 {
        (0xff, 0x9f, 0x0a)
    } else {
        (0x34, 0xc7, 0x59)
    }
}
