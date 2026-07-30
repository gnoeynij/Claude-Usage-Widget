import { describe, expect, it } from "vitest";
import { isSameWindow, WINDOW_JITTER_TOLERANCE_MS } from "./notifyWindow";

describe("isSameWindow — resets_at jitter dedup", () => {
  it("exact same string is the same window", () => {
    const ts = "2026-07-28T04:39:59.368596+00:00";
    expect(isSameWindow(ts, ts)).toBe(true);
  });

  it("no stored window (fresh boot) is never the same window", () => {
    expect(isSameWindow(null, "2026-07-28T04:39:59+00:00")).toBe(false);
    expect(isSameWindow(undefined, "2026-07-28T04:39:59+00:00")).toBe(false);
  });

  it("per-poll server jitter (~1.1s, observed live) is the same window", () => {
    // Real pair captured from widget-settings.json across one sync — the
    // exact drift that re-fired the threshold toast on every sync.
    expect(
      isSameWindow(
        "2026-07-27T09:29:59.159974+00:00",
        "2026-07-27T09:30:00.306225+00:00",
      ),
    ).toBe(true);
  });

  it("sub-second (microsecond field) drift is the same window", () => {
    expect(
      isSameWindow(
        "2026-07-27T05:59:59.159991+00:00",
        "2026-07-27T05:59:59.257424+00:00",
      ),
    ).toBe(true);
  });

  it("a genuinely new 5h session block re-arms notifications", () => {
    expect(
      isSameWindow(
        "2026-07-28T04:39:59+00:00",
        "2026-07-28T09:39:59+00:00", // +5h
      ),
    ).toBe(false);
  });

  it("a weekly rollover re-arms notifications", () => {
    expect(
      isSameWindow(
        "2026-07-27T06:00:00+00:00",
        "2026-08-03T06:00:00+00:00", // +7d
      ),
    ).toBe(false);
  });

  it("tolerance boundary: inside stays same, outside is a new window", () => {
    const base = Date.parse("2026-07-28T04:00:00+00:00");
    const at = (ms: number) => new Date(base + ms).toISOString();
    expect(isSameWindow(at(0), at(WINDOW_JITTER_TOLERANCE_MS - 1000))).toBe(true);
    expect(isSameWindow(at(0), at(WINDOW_JITTER_TOLERANCE_MS + 1000))).toBe(false);
  });

  it("unparseable timestamps only match by exact equality", () => {
    expect(isSameWindow("not-a-date", "not-a-date")).toBe(true);
    expect(isSameWindow("not-a-date", "also-not-a-date")).toBe(false);
  });
});
