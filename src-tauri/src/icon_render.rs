//! Runtime gauge-icon rendering for the tray and taskbar icons.
//!
//! Matches the static source.png design (dark rounded-square, half-circle
//! gauge, white needle + hub) at a small size that's legible at 16–32px and
//! still readable when Windows scales up to ~48px for the taskbar at higher
//! DPI.
//!
//! Threshold colors mirror the in-app capsule/donut tokens so the tray
//! gauge tells the same story as the widget content: accent (<50%), warning
//! orange (50–80%), danger red (>80%).

use tiny_skia::{Color, LineCap, Paint, PathBuilder, Pixmap, Stroke, Transform};

// 128 instead of 64 so the taskbar/tray downscaler has more pixels to work
// with — at small sizes (24px) thin features vanished. stroke ~17% of size.
const SIZE: u32 = 128;
const STROKE_W: f32 = 22.0;
const RADIUS: f32 = 44.0;

/// Render the gauge icon and return raw RGBA bytes + size, ready for
/// `tauri::image::Image::new_owned`. Tauri's Image type expects raw RGBA
/// (one byte each for R, G, B, A), not PNG-encoded bytes.
pub fn render_gauge_rgba(pct: f64) -> (Vec<u8>, u32, u32) {
    let png_bytes = render_gauge_pixmap(pct);
    (png_bytes, SIZE, SIZE)
}

fn render_gauge_pixmap(pct: f64) -> Vec<u8> {
    let pct = pct.clamp(0.0, 100.0) as f32;
    let pixmap = Pixmap::new(SIZE, SIZE).expect("pixmap alloc");
    // Transparent canvas — no rounded-square background. Taskbar / tray
    // already provides the surrounding chrome and a dark fill here would
    // just merge into the taskbar (or stand out harshly on light themes).
    // The static .ico (used for launcher/installer) keeps the rounded BG.
    let mut pixmap = pixmap;

    let cx = SIZE as f32 / 2.0;
    let cy = SIZE as f32 / 2.0 + 12.0;

    // Gauge track — black alpha so the unfilled half-ring stays visible on
    // light taskbars (where a grey alpha disappeared entirely) and still
    // reads as a subtle outline on dark taskbars.
    draw_arc(&mut pixmap, cx, cy, RADIUS, 0.0, 1.0, STROKE_W, Color::from_rgba8(0, 0, 0, 110));

    // Gauge fill — threshold-colored, sweeps to `pct` of the 180° track.
    let fill_color = threshold_color(pct);
    let fill_t = pct / 100.0;
    if fill_t > 0.001 {
        draw_arc(&mut pixmap, cx, cy, RADIUS, 0.0, fill_t, STROKE_W, fill_color);
    }

    // Needle — analog-gauge identity. Drawn with a white outer stroke +
    // black inner stroke so it stays legible on both dark and light
    // taskbars (a single-color needle disappeared against one or the
    // other). Length stops just shy of the arc so it visually anchors
    // to the fill endpoint.
    {
        let angle = std::f32::consts::PI + std::f32::consts::PI * fill_t;
        let needle_len = RADIUS - 4.0;
        let nx = cx + needle_len * angle.cos();
        let ny = cy + needle_len * angle.sin();
        let mut pb = PathBuilder::new();
        pb.move_to(cx, cy);
        pb.line_to(nx, ny);
        let path = pb.finish().expect("needle path");

        // Outer white outline.
        let mut paint_outer = Paint::default();
        paint_outer.set_color(Color::from_rgba8(255, 255, 255, 230));
        paint_outer.anti_alias = true;
        let stroke_outer = Stroke {
            width: 13.0,
            line_cap: LineCap::Round,
            ..Stroke::default()
        };
        pixmap.stroke_path(&path, &paint_outer, &stroke_outer, Transform::identity(), None);

        // Inner black core.
        let mut paint_inner = Paint::default();
        paint_inner.set_color(Color::from_rgba8(20, 20, 24, 255));
        paint_inner.anti_alias = true;
        let stroke_inner = Stroke {
            width: 7.0,
            line_cap: LineCap::Round,
            ..Stroke::default()
        };
        pixmap.stroke_path(&path, &paint_inner, &stroke_inner, Transform::identity(), None);
    }

    // Hub — white disk with black core, matches the needle's outline trick.
    {
        let mut paint_outer = Paint::default();
        paint_outer.set_color(Color::from_rgba8(255, 255, 255, 230));
        paint_outer.anti_alias = true;
        let mut pb_o = PathBuilder::new();
        pb_o.push_circle(cx, cy, 10.0);
        let path_o = pb_o.finish().expect("hub outer path");
        pixmap.fill_path(&path_o, &paint_outer, tiny_skia::FillRule::Winding, Transform::identity(), None);

        let mut paint_inner = Paint::default();
        paint_inner.set_color(Color::from_rgba8(20, 20, 24, 255));
        paint_inner.anti_alias = true;
        let mut pb_i = PathBuilder::new();
        pb_i.push_circle(cx, cy, 5.0);
        let path_i = pb_i.finish().expect("hub inner path");
        pixmap.fill_path(&path_i, &paint_inner, tiny_skia::FillRule::Winding, Transform::identity(), None);
    }

    // tiny-skia Pixmap stores raw RGBA bytes — exactly what Tauri's
    // Image::new_owned wants. No PNG encoding step.
    pixmap.take()
}

/// Draw an arc as a polyline approximation. `start_t`/`end_t` are 0..1
/// along the bottom half-circle (180° sweep starting from 9 o'clock).
fn draw_arc(
    pixmap: &mut Pixmap,
    cx: f32,
    cy: f32,
    r: f32,
    start_t: f32,
    end_t: f32,
    stroke_w: f32,
    color: Color,
) {
    const SEGMENTS: usize = 64;
    let start_angle = std::f32::consts::PI + start_t * std::f32::consts::PI;
    let end_angle = std::f32::consts::PI + end_t * std::f32::consts::PI;
    let mut pb = PathBuilder::new();
    for i in 0..=SEGMENTS {
        let t = i as f32 / SEGMENTS as f32;
        let a = start_angle + (end_angle - start_angle) * t;
        let x = cx + r * a.cos();
        let y = cy + r * a.sin();
        if i == 0 {
            pb.move_to(x, y);
        } else {
            pb.line_to(x, y);
        }
    }
    let path = pb.finish().expect("arc path");

    let mut paint = Paint::default();
    paint.set_color(color);
    paint.anti_alias = true;
    let stroke = Stroke {
        width: stroke_w,
        line_cap: LineCap::Round,
        ..Stroke::default()
    };
    pixmap.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
}

/// Match the in-app Donut threshold (`src/utils/color.ts::thresholdColor`):
///   <50% → --success #34c759   green
///   50-80% → --warning #ff9f0a  amber
///   ≥80%  → --danger  #ff453a   red
fn threshold_color(pct: f32) -> Color {
    if pct >= 80.0 {
        Color::from_rgba8(0xff, 0x45, 0x3a, 255)
    } else if pct >= 50.0 {
        Color::from_rgba8(0xff, 0x9f, 0x0a, 255)
    } else {
        Color::from_rgba8(0x34, 0xc7, 0x59, 255)
    }
}
