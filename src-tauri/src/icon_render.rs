// Paint::default() 후 set_color/anti_alias 재할당 패턴이 여러 함수에 반복.
// struct literal 로 바꿔도 가독성 차이 없고 logic 동일이라 module-level silence.
#![allow(clippy::field_reassign_with_default)]

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

/// 1px morphological dilation of the crab alpha channel — *외곽 1px* 픽셀에
/// 만 alpha 가 들어가고 본체 영역(원본 crab opaque)은 0. 결과 buffer 는
/// RGB=0(검정), alpha=neighbor max. 흰 crab 보다 *먼저* blit 하면 본체는
/// 흰 crab 에 덮이고 외곽 1px 만 검은 stroke 으로 남아 halo 배경 위에서
/// contrast 가 보장된다.
static CACHED_CRAB_STROKE: Lazy<Vec<u8>> = Lazy::new(|| {
    let crab = &*CACHED_CRAB;
    let w = CRAB_W as usize;
    let h = CRAB_H as usize;
    let mut stroke = vec![0u8; w * h * 4];
    for y in 0..h {
        for x in 0..w {
            let idx = (y * w + x) * 4;
            // 본체(crab 자체 opaque) 위치엔 stroke 안 그림
            if crab[idx + 3] > 0 {
                continue;
            }
            let mut max_neighbor = 0u8;
            // 8-방향 (corner 포함) — 4-방향만 하면 corner 가 빠져 들쭉날쭉
            for dy in -1i32..=1 {
                for dx in -1i32..=1 {
                    if dx == 0 && dy == 0 {
                        continue;
                    }
                    let nx = x as i32 + dx;
                    let ny = y as i32 + dy;
                    if nx < 0 || nx >= w as i32 || ny < 0 || ny >= h as i32 {
                        continue;
                    }
                    let nidx = ((ny as usize) * w + (nx as usize)) * 4;
                    let a = crab[nidx + 3];
                    if a > max_neighbor {
                        max_neighbor = a;
                    }
                }
            }
            if max_neighbor > 0 {
                stroke[idx + 3] = max_neighbor;
            }
        }
    }
    stroke
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
    // Cap halo core alpha at 235 (~92%). 가시성 부족 피드백에 따라 ↑.
    // 100% 보단 여전히 부드러움 보존. swing 0.7~1.0 와 곱해져 실제
    // 시각 core alpha 는 164~235 (≈ 64%~92%) 라 항상 인지 가능.
    let core_alpha = (235.0 * alpha_factor) as u8;
    draw_halo(&mut pixmap, r, g, b, core_alpha);

    // Crab + stroke 정적 유지 — halo 만 호흡. brand identity 가 매 frame
    // 명확. (사용자 1번 옵션 시험)
    let crab_alpha = 250u8;
    let crab_x = (SIZE - CRAB_W) / 2;
    let crab_y = (SIZE - CRAB_H) / 2;
    // Stroke 먼저 (검정) → 흰 crab 이 본체 영역 덮어 외곽 1px 만 stroke 남음
    blit_stroke(&mut pixmap, crab_x, crab_y, crab_alpha);
    blit_crab_tinted(&mut pixmap, crab_x, crab_y, 255, 255, 255, crab_alpha);

    pixmap.take()
}

fn render_error(alpha_factor: f32) -> Vec<u8> {
    let alpha_factor = alpha_factor.clamp(0.0, 1.0);
    let mut pixmap = Pixmap::new(SIZE, SIZE).expect("pixmap alloc");
    // Neutral grey halo — 색 신호 부재 = "데이터 없음"
    let core_alpha = (220.0 * alpha_factor) as u8;
    draw_halo(&mut pixmap, 140, 140, 150, core_alpha);

    // Error 상태에서도 crab 정적 — 일관성
    let crab_alpha = 180u8;
    let crab_x = (SIZE - CRAB_W) / 2;
    let crab_y = (SIZE - CRAB_H) / 2;
    blit_stroke(&mut pixmap, crab_x, crab_y, crab_alpha);
    blit_crab_tinted(&mut pixmap, crab_x, crab_y, 255, 255, 255, crab_alpha);

    // 우상단 빨간 status dot — 회색 halo 만으론 "오류" 인지 약함. dot 은
    // crab 본체와 분리된 corner overlay 라 사용량 100%(빨간 halo)와 혼동 X.
    // 검은 outline 으로 라이트/다크 트레이 양쪽 contrast 보장.
    draw_error_dot(&mut pixmap);

    pixmap.take()
}

fn draw_error_dot(pixmap: &mut Pixmap) {
    let cx = 108.0;
    let cy = 18.0;
    let r = 14.0;

    // Dark outline (2px) — 라이트 트레이에서도 빨강 dot 분리감 보장
    let mut outline_pb = PathBuilder::new();
    outline_pb.push_circle(cx, cy, r + 2.0);
    if let Some(outline_path) = outline_pb.finish() {
        let mut outline_paint = Paint::default();
        outline_paint.set_color(Color::from_rgba8(20, 20, 20, 220));
        outline_paint.anti_alias = true;
        pixmap.fill_path(
            &outline_path,
            &outline_paint,
            FillRule::Winding,
            Transform::identity(),
            None,
        );
    }

    // Red fill (threshold danger 색과 동일)
    let mut dot_pb = PathBuilder::new();
    dot_pb.push_circle(cx, cy, r);
    if let Some(dot_path) = dot_pb.finish() {
        let mut dot_paint = Paint::default();
        dot_paint.set_color(Color::from_rgba8(0xff, 0x45, 0x3a, 255));
        dot_paint.anti_alias = true;
        pixmap.fill_path(
            &dot_path,
            &dot_paint,
            FillRule::Winding,
            Transform::identity(),
            None,
        );
    }
}

/// Radial halo: Gaussian-스러운 5-stop falloff. 이전엔 0~0.55 solid core
/// 였다가 0.55~0.85 사이에 alpha 가 급강하해서 사용자에게 *경계선* 처럼
/// 보였음. 점진적 stops 로 자연스러운 광원 falloff 흉내.
fn draw_halo(pixmap: &mut Pixmap, r: u8, g: u8, b: u8, core_alpha: u8) {
    let cx = SIZE as f32 / 2.0;
    let cy = SIZE as f32 / 2.0;
    let halo_r = 62.0;

    let core = core_alpha as f32;
    // Stops 분포: core 영역을 두텁게(0.3 까지 90%) 유지해 *면적 평균 alpha*
    // 가 충분하고, 0.55→0.8 사이만 본격 falloff. 단 stops 5 개 분포라
    // 단일 sharp drop 없어 edge 가 명확히 안 보임 (이전 4-stop 회귀 방어).
    let stops = vec![
        GradientStop::new(0.0, Color::from_rgba8(r, g, b, core_alpha)),
        GradientStop::new(0.3, Color::from_rgba8(r, g, b, (core * 0.9) as u8)),
        GradientStop::new(0.55, Color::from_rgba8(r, g, b, (core * 0.65) as u8)),
        GradientStop::new(0.8, Color::from_rgba8(r, g, b, (core * 0.3) as u8)),
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

/// Premultiplied black source-over composite, sourced from `CACHED_CRAB_STROKE`
/// (1px outer dilation of crab alpha). RGB always 0; only alpha varies.
fn blit_stroke(pixmap: &mut Pixmap, dx: u32, dy: u32, alpha_mult: u8) {
    let stroke = &*CACHED_CRAB_STROKE;
    let canvas_w = pixmap.width();
    let canvas_h = pixmap.height();
    let canvas_bytes = pixmap.data_mut();
    for y in 0..CRAB_H {
        for x in 0..CRAB_W {
            let src_idx = ((y * CRAB_W + x) * 4) as usize;
            let src_a = stroke[src_idx + 3];
            if src_a == 0 {
                continue;
            }
            let a = ((src_a as u16) * (alpha_mult as u16) / 255) as u8;
            if a == 0 {
                continue;
            }
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
            // Black src (R=G=B=0 premultiplied), so out_RGB = dst_RGB * (1 - src_a)
            canvas_bytes[dst_idx]     = ((dst_r as u16) * (inv_a as u16) / 255) as u8;
            canvas_bytes[dst_idx + 1] = ((dst_g as u16) * (inv_a as u16) / 255) as u8;
            canvas_bytes[dst_idx + 2] = ((dst_b as u16) * (inv_a as u16) / 255) as u8;
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
