#!/usr/bin/env bash
# capture-widget.sh — macOS counterpart to capture-widget.ps1.
# Captures the Claude Widget OS-composited (so NSVisualEffectView blur and
# layered alpha are honored — matches what the user actually sees).
#
# Usage:
#   bash scripts/capture-widget.sh [output-path]
#
# Default output: ~/Desktop/imgs/widget-capture.png

set -e

OUT="${1:-$HOME/Desktop/imgs/widget-capture.png}"
APP_NAME="Claude Widget"

if ! pgrep -f "claude-widget" >/dev/null; then
  echo "widget not running" >&2
  exit 1
fi

# Try the automated path first: System Events reads window position+size,
# screencapture -R clips to that rect. Needs Accessibility permission for
# whichever terminal is running this — first invocation triggers the OS
# permission dialog.
BOUNDS=$(osascript <<EOF 2>/dev/null
tell application "System Events"
  tell process "$APP_NAME"
    set p to position of window 1
    set s to size of window 1
    return ((item 1 of p) as string) & "," & ((item 2 of p) as string) & "," & ((item 1 of s) as string) & "," & ((item 2 of s) as string)
  end tell
end tell
EOF
) || true

mkdir -p "$(dirname "$OUT")"

if [ -z "$BOUNDS" ]; then
  echo "could not read widget window bounds — grant Accessibility permission:" >&2
  echo "  System Settings → Privacy & Security → Accessibility → enable for Terminal" >&2
  echo "Falling back to interactive picker — click the widget window." >&2
  screencapture -o -w "$OUT"
  echo "saved $OUT (interactive)"
  exit 0
fi

IFS=',' read -r X Y W H <<<"$BOUNDS"
screencapture -R "${X},${Y},${W},${H}" "$OUT"
echo "saved $OUT (${W}x${H})"
