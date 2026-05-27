"""Generate multi-size tray ICOs (ok/err) from tray.png with status dot.

dot 위치 = crab 본체 박스 우상단 모서리, dot 절반은 안쪽·절반은 위/밖 영역.
사이즈별로 dot 좌표/사이즈 따로 산출, 16/20 은 사각형 (anti-alias 흐림 회피),
24+ 는 원 ± 검은 outline (트레이 배경 무관 가독성).
"""
import io
import struct
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "src-tauri" / "icons"
BASE = ICON_DIR / "tray.png"

SIZES = [16, 20, 24, 32, 48]

COLORS = {
    "ok": (52, 199, 89, 255),
    "err": (255, 59, 48, 255),
}


def measure_body_top_right(base: Image.Image) -> tuple[float, float]:
    """본체 박스 (눈 있는 큰 직사각형) 의 우상단 모서리 normalized 좌표."""
    bbox = base.getbbox()
    top_y = bbox[1]
    w = base.size[0]
    probe_y = top_y + 5
    alpha_band = base.split()[-1]
    row = list(alpha_band.crop((0, probe_y, w, probe_y + 1)).getdata())
    body_right_x = max(i for i, a in enumerate(row) if a > 0)
    return body_right_x / w, top_y / base.size[1]


def make_frame(
    base: Image.Image, size: int, nx: float, ny: float, color, outline: bool
) -> Image.Image:
    img = base.resize((size, size), Image.LANCZOS)
    dot_d = max(4, round(size * 0.32))
    cx = nx * size
    cy = ny * size
    half = dot_d / 2
    x0, y0 = cx - half, cy - half
    x1, y1 = x0 + dot_d, y0 + dot_d
    if x1 > size:
        x0 -= x1 - size
        x1 = size
    if x0 < 0:
        x1 -= x0
        x0 = 0
    if y0 < 0:
        y1 -= y0
        y0 = 0
    if y1 > size:
        y0 -= y1 - size
        y1 = size
    draw = ImageDraw.Draw(img)
    if size <= 20:
        box = (int(round(x0)), int(round(y0)), int(round(x1)) - 1, int(round(y1)) - 1)
        draw.rectangle(box, fill=color)
    else:
        box = (x0, y0, x1 - 1, y1 - 1)
        if outline:
            outline_w = 1 if size <= 32 else 2
            draw.ellipse(box, fill=color, outline=(0, 0, 0, 255), width=outline_w)
        else:
            draw.ellipse(box, fill=color)
    return img


def save_ico(frames: list[Image.Image], path: Path) -> None:
    encoded = []
    for f in frames:
        buf = io.BytesIO()
        f.save(buf, format="PNG")
        encoded.append(buf.getvalue())
    n = len(frames)
    header = struct.pack("<HHH", 0, 1, n)
    offset = 6 + 16 * n
    entries = b""
    for f, data in zip(frames, encoded):
        w, h = f.size
        entries += struct.pack(
            "<BBBBHHII",
            w if w < 256 else 0,
            h if h < 256 else 0,
            0, 0, 1, 32,
            len(data), offset,
        )
        offset += len(data)
    path.write_bytes(header + entries + b"".join(encoded))


def generate(base: Image.Image, nx: float, ny: float, outline: bool, preview_dir: Path,
             write_ico_to: Path | None = None) -> None:
    preview_dir.mkdir(exist_ok=True)
    for state, color in COLORS.items():
        frames = [make_frame(base, s, nx, ny, color, outline) for s in SIZES]
        if write_ico_to is not None:
            save_ico(frames, write_ico_to / f"tray-{state}.ico")
            # Tauri 2 Image API 는 single-res — 32x32 PNG 별도 export 해서 embed
            # (16x16 트레이로 2x down-scale, OS bilinear 깨끗)
            idx = SIZES.index(32)
            frames[idx].save(write_ico_to / f"tray-{state}-32.png")
        for size, frame in zip(SIZES, frames):
            frame.save(preview_dir / f"tray-{state}-{size}.png")
            up = frame.resize((size * 8, size * 8), Image.NEAREST)
            up.save(preview_dir / f"tray-{state}-{size}_8x.png")


def main() -> None:
    base = Image.open(BASE).convert("RGBA")
    nx, ny = measure_body_top_right(base)
    print(f"body top-right normalized: ({nx:.4f}, {ny:.4f})")
    # 확정: flat (outline 없음) — ICO 저장
    generate(base, nx, ny, outline=False,
             preview_dir=ROOT / "tmp-tray-preview-flat",
             write_ico_to=ICON_DIR)
    print("done")


if __name__ == "__main__":
    main()
