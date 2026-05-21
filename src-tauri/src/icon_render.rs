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
//! `alpha_factor` 는 0.0~1.0 범위의 전체 alpha 곱. frontend 의 breathing tick
//! 이 매 100ms 마다 sine wave 값을 보내 발광체가 호흡하는 효과.

use image::imageops::FilterType;
use once_cell::sync::Lazy;
use tiny_skia::{
    Color, FillRule, GradientStop, Paint, PathBuilder, Pixmap, Point, RadialGradient, Rect,
    SpreadMode, Transform,
};

const SIZE: u32 = 128;
const CRAB_W: u32 = 90;
// 90 * 160 / 256 = 56.25 → 56. const fn 산술이 제한적이라 하드코딩.
const CRAB_H: u32 = 56;

/// Anthropic pixel mark, embedded so the tray icon ships in the .exe.
const CRAB_PNG: &[u8] = include_bytes!("../../src/assets/claude-header.png");

/// Pre-decoded + resized crab. PNG decode + Lanczos3 resize 는 무거워서
/// breathing(100ms tick) 시점에 매번 하면 CPU 부담이 누적된다. 캐시로
/// 한 번만 처리하고 blit 시점에는 byte 복사 + alpha 합성만.
static CACHED_CRAB: Lazy<Vec<u8>> = Lazy::new(|| {
    let img = image::load_from_memory_with_format(CRAB_PNG, image::ImageFormat::Png)
        .expect("decode crab");
    let resized = img.resize_exact(CRAB_W, CRAB_H, FilterType::Lanczos3);
    resized.to_rgba8().into_raw()
});

pub fn render_gauge_rgba(pct: f64, alpha_factor: f32) -> (Vec<u8>, u32, u32) {
    let bytes = if pct < 0.0 {
        render_error(alpha_factor)
    } else {
        render_pixel_halo(pct, alpha_factor)
    };
    (bytes, SIZE, SIZE)
}

fn render_pixel_halo(pct: f64, alpha_factor: f32) -> Vec<u8> {
    let pct = pct.clamp(0.0, 100.0) as f32;
    let alpha_factor = alpha_factor.clamp(0.0, 1.0);
    let mut pixmap = Pixmap::new(SIZE, SIZE).expect("pixmap alloc");

    let (r, g, b) = threshold_rgb(pct);
    // Cap halo core alpha at 200 (~78%) — full 255 가 트레이에서 *너무 진해*
    // 라는 피드백. 78% 까지 내려도 색 신호는 인지 가능하면서 발광체 톤이
    // 한결 부드러워짐.
    let core_alpha = (200.0 * alpha_factor) as u8;
    draw_halo(&mut pixmap, r, g, b, core_alpha);

    // Crab 도 살짝 호흡 — 단 완전히 사라지지 않도록 0.7~1.0 range 로 잡아
    // brand identity 가 매 frame 인식되도록 유지. 220 cap 으로 halo 와
    // 톤 균형.
    let crab_alpha = (220.0 * (0.7 + 0.3 * alpha_factor)) as u8;
    let crab_x = (SIZE - CRAB_W) / 2;
    let crab_y = (SIZE - CRAB_H) / 2;
    blit_crab_tinted(&mut pixmap, crab_x, crab_y, 255, 255, 255, crab_alpha);

    pixmap.take()
}

fn render_error(alpha_factor: f32) -> Vec<u8> {
    let alpha_factor = alpha_factor.clamp(0.0, 1.0);
    let mut pixmap = Pixmap::new(SIZE, SIZE).expect("pixmap alloc");
    // Neutral grey halo — 색 신호 부재 = "데이터 없음"
    let core_alpha = (220.0 * alpha_factor) as u8;
    draw_halo(&mut pixmap, 140, 140, 150, core_alpha);

    let crab_alpha = (180.0 * (0.7 + 0.3 * alpha_factor)) as u8;
    let crab_x = (SIZE - CRAB_W) / 2;
    let crab_y = (SIZE - CRAB_H) / 2;
    blit_crab_tinted(&mut pixmap, crab_x, crab_y, 255, 255, 255, crab_alpha);

    pixmap.take()
}

/// Radial halo: Gaussian-스러운 5-stop falloff. 이전엔 0~0.55 solid core
/// 였다가 0.55~0.85 사이에 alpha 가 급강하해서 사용자에게 *경계선* 처럼
/// 보였음. 점진적 stops 로 자연스러운 광원 falloff 흉내.
fn draw_halo(pixmap: &mut Pixmap, r: u8, g: u8, b: u8, core_alpha: u8) {
    let cx = SIZE as f32 / 2.0;
    let cy = SIZE as f32 / 2.0;
    let halo_r = 62.0;

    let core = core_alpha as f32;
    let stops = vec![
        GradientStop::new(0.0, Color::from_rgba8(r, g, b, core_alpha)),
        GradientStop::new(0.25, Color::from_rgba8(r, g, b, (core * 0.82) as u8)),
        GradientStop::new(0.5, Color::from_rgba8(r, g, b, (core * 0.46) as u8)),
        GradientStop::new(0.75, Color::from_rgba8(r, g, b, (core * 0.17) as u8)),
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

/// Source-over composite of cached crab buffer onto pixmap, with RGB tinted to
/// (tr, tg, tb) and alpha multiplied by `alpha_mult/255`. tiny-skia stores
/// premultiplied RGBA; image crate returns straight RGBA, so we both
/// premultiply *and* blend manually.
#[allow(clippy::too_many_arguments)]
fn blit_crab_tinted(
    pixmap: &mut Pixmap,
    dx: u32,
    dy: u32,
    tr: u8,
    tg: u8,
    tb: u8,
    alpha_mult: u8,
) {
    let rgba = &*CACHED_CRAB;
    let canvas_w = pixmap.width();
    let canvas_h = pixmap.height();
    let canvas_bytes = pixmap.data_mut();
    for y in 0..CRAB_H {
        for x in 0..CRAB_W {
            let src_idx = ((y * CRAB_W + x) * 4) as usize;
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
