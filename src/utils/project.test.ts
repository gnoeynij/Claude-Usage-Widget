import { describe, it, expect } from "vitest";
import {
  projectLimit,
  blendPace,
  decayPace,
  SESSION_WINDOW_MS,
  WEEKLY_WINDOW_MS,
} from "./project";

const NOW = 1_700_000_000_000;
const iso = (msAhead: number) => new Date(NOW + msAhead).toISOString();
const W = SESSION_WINDOW_MS;

describe("projectLimit — guards", () => {
  it("null below the 2% floor", () => {
    expect(projectLimit(1, iso(W / 2), W, NOW)).toBeNull();
  });
  it("null at/over 100%", () => {
    expect(projectLimit(100, iso(W / 2), W, NOW)).toBeNull();
  });
  it("null without a reset time", () => {
    expect(projectLimit(50, null, W, NOW)).toBeNull();
  });
  it("null when the reset is already past", () => {
    expect(projectLimit(50, iso(-1000), W, NOW)).toBeNull();
  });
  it("null early in the window (elapsed 10% < default ratio 0.2)", () => {
    expect(projectLimit(5, iso(W * 0.9), W, NOW)).toBeNull();
  });
});

describe("projectLimit — projection", () => {
  it("average pace: half-elapsed 50% projects to exactly 100% at reset", () => {
    const p = projectLimit(50, iso(W / 2), W, NOW)!;
    expect(p).not.toBeNull();
    expect(p.projectedPct).toBeCloseTo(100, 6);
    expect(p.hitsBeforeReset).toBe(true);
    expect(p.msToLimit).toBeCloseTo(W / 2, 3); // (100-50)/avgPace
  });

  it("stays safe when the average lands under 100%", () => {
    // elapsed 80% of window, 40% used → projected 40 + (50/W)*(0.2W) = 50
    const p = projectLimit(40, iso(W * 0.2), W, NOW)!;
    expect(p.projectedPct).toBeCloseTo(50, 6);
    expect(p.hitsBeforeReset).toBe(false);
    expect(p.msToLimit).toBe(0);
  });

  it("escalates when recentPace exceeds the average", () => {
    const avgPace = 50 / (W / 2);
    const p = projectLimit(50, iso(W / 2), W, NOW, avgPace * 2)!;
    expect(p.projectedPct).toBeCloseTo(150, 6); // 50 + 2*avg*msToReset
    expect(p.hitsBeforeReset).toBe(true);
    expect(p.msToLimit).toBeCloseTo(W / 4, 3); // half the avg-only ETA
  });

  it("ignores recentPace below the average (floor never under-warns)", () => {
    const avgPace = 50 / (W / 2);
    const p = projectLimit(50, iso(W / 2), W, NOW, avgPace / 2)!;
    expect(p.projectedPct).toBeCloseTo(100, 6); // average path unchanged
  });

  it("weekly passes the 0.1 ratio where the default 0.2 would suppress", () => {
    const msToReset = WEEKLY_WINDOW_MS * 0.85; // elapsed 15%
    expect(projectLimit(5, iso(msToReset), WEEKLY_WINDOW_MS, NOW)).toBeNull();
    expect(
      projectLimit(5, iso(msToReset), WEEKLY_WINDOW_MS, NOW, undefined, 0.1),
    ).not.toBeNull();
  });

  it("msToLimit never exceeds msToReset when hitsBeforeReset (invariant)", () => {
    // hitsBeforeReset ⟺ projected ≥ 100 ⟺ msToReset ≥ (100−pct)/pace = msToLimit,
    // so even a pace barely over break-even lands the ETA at (not past) reset.
    const msToReset = W / 2;
    const breakEven = (100 - 30) / msToReset; // pace that lands exactly 100 at reset
    const p = projectLimit(30, iso(msToReset), W, NOW, breakEven * 1.0001)!;
    expect(p.hitsBeforeReset).toBe(true);
    expect(p.msToLimit).toBeLessThanOrEqual(msToReset);
  });

  it("treats recentPace exactly equal to the average as the average path", () => {
    const avgPace = 50 / (W / 2);
    const p = projectLimit(50, iso(W / 2), W, NOW, avgPace)!; // == avg (strict > is false)
    expect(p.projectedPct).toBeCloseTo(100, 6); // not escalated above the average
  });
});

describe("blendPace", () => {
  const opts = { alpha: 0.4, minIntervalMs: 30_000 };

  it("seeds the sample on the first call, pace unchanged", () => {
    const r = blendPace(0, null, 10, NOW, opts);
    expect(r.pace).toBe(0);
    expect(r.sample).toEqual({ pct: 10, ts: NOW });
  });

  it("resets to 0 when usage drops (window reset)", () => {
    const r = blendPace(0.005, { pct: 80, ts: NOW - 60_000 }, 3, NOW, opts);
    expect(r.pace).toBe(0);
    expect(r.sample).toEqual({ pct: 3, ts: NOW });
  });

  it("ignores too-short intervals (anti-spike) and keeps the old sample", () => {
    const sample = { pct: 10, ts: NOW - 5_000 }; // 5s < 30s
    const r = blendPace(2, sample, 11, NOW, opts);
    expect(r.pace).toBe(2);
    expect(r.sample).toBe(sample);
  });

  it("EMA-blends a fresh observation over a valid interval", () => {
    const r = blendPace(0, { pct: 10, ts: NOW - 60_000 }, 70, NOW, opts);
    expect(r.pace).toBeCloseTo(0.4 * 0.001, 10); // raw = 60% / 60_000ms
    expect(r.sample).toEqual({ pct: 70, ts: NOW });
  });

  it("keeps (1-alpha) of the prior pace when usage is flat", () => {
    const r = blendPace(0.002, { pct: 10, ts: NOW - 60_000 }, 10, NOW, opts);
    expect(r.pace).toBeCloseTo(0.6 * 0.002, 10);
  });

  it("ignores a backward clock (now < sample.ts) instead of a negative raw", () => {
    const sample = { pct: 10, ts: NOW + 10_000 }; // sample stamped in the future
    const r = blendPace(0.002, sample, 15, NOW, opts);
    expect(r.pace).toBe(0.002); // unchanged — no negative/huge spike
    expect(r.sample).toBe(sample);
  });
});

describe("decayPace", () => {
  const HL = 12 * 60_000;
  it("halves over one half-life", () => {
    expect(decayPace(1, HL, HL)).toBeCloseTo(0.5, 10);
  });
  it("quarters over two half-lives", () => {
    expect(decayPace(1, 2 * HL, HL)).toBeCloseTo(0.25, 10);
  });
  it("no-op for zero dt", () => {
    expect(decayPace(0.5, 0, HL)).toBe(0.5);
  });
  it("no-op for zero pace", () => {
    expect(decayPace(0, 60_000, HL)).toBe(0);
  });
  it("decreases monotonically with elapsed time", () => {
    expect(decayPace(1, 120_000, HL)).toBeLessThan(decayPace(1, 60_000, HL));
  });
});
