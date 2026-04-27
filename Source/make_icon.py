"""
assets/icon.ico 생성 스크립트 — 원본 Claude SVG 아이콘 사용
PyQt6 + QSvgRenderer로 SVG를 렌더링 후 Pillow로 .ico 저장
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from PyQt6.QtWidgets import QApplication
from PyQt6.QtGui import QPainter, QPixmap, QColor
from PyQt6.QtSvg import QSvgRenderer
from PyQt6.QtCore import Qt, QByteArray, QRectF
from PIL import Image
import io

app = QApplication(sys.argv)

SIZES = [16, 24, 32, 48, 64, 128, 256]
OUT   = os.path.join("assets", "icon.ico")

# Read SVG
svg_path = os.path.join("assets", "claude-icon.svg")
with open(svg_path, "rb") as f:
    svg_bytes = f.read()

pil_frames = []
for sz in SIZES:
    # Render SVG to QPixmap (transparent background)
    px = QPixmap(sz, sz)
    px.fill(Qt.GlobalColor.transparent)
    painter = QPainter(px)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    renderer = QSvgRenderer(QByteArray(svg_bytes))

    # Keep aspect ratio and center
    vb = renderer.viewBox()
    
    # Render unpadded custom PNG for header ONLY AT HIGHEST RES
    if sz == 256 and vb.width() > 0 and vb.height() > 0:
        cr_ratio = 256 / vb.width()
        cr_w = int(vb.width() * cr_ratio)
        cr_h = int(vb.height() * cr_ratio)
        cr_px = QPixmap(cr_w, cr_h)
        cr_px.fill(Qt.GlobalColor.transparent)
        cr_p = QPainter(cr_px)
        cr_p.setRenderHint(QPainter.RenderHint.Antialiasing)
        renderer.render(cr_p, QRectF(0, 0, cr_w, cr_h))
        cr_p.end()
        cr_buf = cr_px.toImage()
        cr_buf = cr_buf.convertToFormat(cr_buf.Format.Format_RGBA8888)
        cr_bits = cr_buf.bits()
        cr_bits.setsize(cr_buf.sizeInBytes())
        cr_img = Image.frombytes("RGBA", (cr_w, cr_h), bytes(cr_bits))
        cr_img.save(os.path.join("assets", "claude-header.png"))

    if vb.width() > 0 and vb.height() > 0:
        ratio  = min(sz / vb.width(), sz / vb.height())
        rw, rh = vb.width() * ratio, vb.height() * ratio
        rx = (sz - rw) / 2
        ry = (sz - rh) / 2
        renderer.render(painter, QRectF(rx, ry, rw, rh))
    else:
        renderer.render(painter)
    painter.end()

    # QPixmap → PIL Image via PNG bytes
    buf = px.toImage()
    buf = buf.convertToFormat(buf.Format.Format_RGBA8888)
    bits = buf.bits()
    bits.setsize(buf.sizeInBytes())
    pil_img = Image.frombytes("RGBA", (sz, sz), bytes(bits))
    pil_frames.append(pil_img)

pil_frames[0].save(
    OUT, format="ICO",
    sizes=[(s, s) for s in SIZES],
    append_images=pil_frames[1:],
)
print(f"Icon saved: {OUT}  ({len(pil_frames)} sizes: {SIZES})")
