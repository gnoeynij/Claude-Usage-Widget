use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Clone, Copy)]
pub struct Pricing {
    pub input: f64,
    pub output: f64,
    pub cache_write_5m: f64,
    pub cache_write_1h: f64,
    pub cache_read: f64,
}

/// USD per million tokens.
/// Official Anthropic pricing: https://platform.claude.com/docs/en/about-claude/pricing
/// (last verified 2026-07-01). When Anthropic ships a new model generation,
/// add an entry below and re-verify the existing ones.
pub static PRICING: Lazy<HashMap<&'static str, Pricing>> = Lazy::new(|| {
    let fable = Pricing {
        // Fable 5 — Mythos-class tier above Opus (released 2026-06-09).
        input: 10.0,
        output: 50.0,
        cache_write_5m: 12.5,
        cache_write_1h: 20.0,
        cache_read: 1.0,
    };
    let opus_current = Pricing {
        // Opus 4.5 / 4.6 / 4.7 / 4.8 — same price tier.
        input: 5.0,
        output: 25.0,
        cache_write_5m: 6.25,
        cache_write_1h: 10.0,
        cache_read: 0.5,
    };
    let opus_legacy = Pricing {
        // Opus 4 / 4.1 — deprecated, retirement 2026-06-15. Same price tier as Opus 3.
        input: 15.0,
        output: 75.0,
        cache_write_5m: 18.75,
        cache_write_1h: 30.0,
        cache_read: 1.5,
    };
    let sonnet = Pricing {
        // Sonnet 4 (deprecated) / 4.5 / 4.6 — all share the same price tier per
        // Anthropic's official table.
        input: 3.0,
        output: 15.0,
        cache_write_5m: 3.75,
        cache_write_1h: 6.0,
        cache_read: 0.3,
    };
    let sonnet_5 = Pricing {
        // Sonnet 5 (released 2026-06-30). Introductory pricing through
        // 2026-08-31; on 2026-09-01 it rises to the standard Sonnet tier
        // ($3/$15 — the `sonnet` values above). Update this block then.
        input: 2.0,
        output: 10.0,
        cache_write_5m: 2.5,
        cache_write_1h: 4.0,
        cache_read: 0.2,
    };
    let haiku_45 = Pricing {
        input: 1.0,
        output: 5.0,
        cache_write_5m: 1.25,
        cache_write_1h: 2.0,
        cache_read: 0.1,
    };
    let haiku_35 = Pricing {
        input: 0.8,
        output: 4.0,
        cache_write_5m: 1.0,
        cache_write_1h: 1.6,
        cache_read: 0.08,
    };

    let mut m = HashMap::new();
    m.insert("claude-fable-5", fable);
    // Mythos 5 — same Mythos-class tier/price as Fable 5 ($10/$50). Limited
    // availability (Project Glasswing), so it won't normally appear in Claude
    // Code JSONL, but priced here so it isn't silently counted as $0.
    m.insert("claude-mythos-5", fable);
    m.insert("claude-opus-4-8", opus_current);
    m.insert("claude-opus-4-7", opus_current);
    m.insert("claude-opus-4-6", opus_current);
    m.insert("claude-opus-4-5", opus_current);
    m.insert("claude-opus-4-1", opus_legacy);
    m.insert("claude-opus-4", opus_legacy);
    m.insert("claude-sonnet-5", sonnet_5);
    m.insert("claude-sonnet-4-6", sonnet);
    m.insert("claude-sonnet-4-5", sonnet);
    m.insert("claude-sonnet-4", sonnet);
    m.insert("claude-haiku-4-5", haiku_45);
    m.insert("claude-3-7-sonnet-latest", sonnet);
    m.insert("claude-3-5-sonnet-latest", sonnet);
    m.insert("claude-3-5-haiku-latest", haiku_35);
    m
});

/// jsonl `model` values often include a date suffix (e.g.
/// `claude-haiku-4-5-20251001`). When several entries match, the longest
/// prefix wins so `claude-opus-4-7-…` resolves to `opus_current` rather than
/// `opus_legacy` via `claude-opus-4`. The boundary after the base must be
/// either end-of-string or `-`, so a hypothetical future `claude-opus-40-…`
/// would not accidentally match `claude-opus-4`.
///
/// Memoized: `cost_usd` runs once per JSONL record, and heavy users have 100k+
/// records resolving the same handful of model ids — without the cache the
/// prefix scan below would repeat tens of thousands of times per aggregate.
/// Pricing is static, so the cache never needs invalidation.
static RESOLVE_CACHE: Lazy<Mutex<HashMap<String, Option<Pricing>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn resolve(model: &str) -> Option<Pricing> {
    if let Some(hit) = RESOLVE_CACHE.lock().unwrap().get(model) {
        return *hit;
    }
    let result = resolve_uncached(model);
    RESOLVE_CACHE
        .lock()
        .unwrap()
        .insert(model.to_string(), result);
    result
}

fn resolve_uncached(model: &str) -> Option<Pricing> {
    if let Some(p) = PRICING.get(model) {
        return Some(*p);
    }
    let mut best: Option<(usize, Pricing)> = None;
    for (base, pricing) in PRICING.iter() {
        if !model.starts_with(base) {
            continue;
        }
        let rest = &model[base.len()..];
        if !(rest.is_empty() || rest.starts_with('-')) {
            continue;
        }
        if best.map_or(true, |(len, _)| base.len() > len) {
            best = Some((base.len(), *pricing));
        }
    }
    best.map(|(_, p)| p)
}

/// Web search server tool: $10 per 1,000 requests, billed on top of token
/// costs. Web fetch is free, so it is not tracked here.
const WEB_SEARCH_USD_PER_REQUEST: f64 = 0.01;

/// `inference_geo: "us"` applies a 1.1x multiplier to all token pricing
/// categories (Opus 4.6 / Sonnet 4.6 and later). It does not apply to the
/// per-request web search charge.
const US_INFERENCE_MULTIPLIER: f64 = 1.1;

/// Fast mode (`speed: "fast"`) reprices supported Opus models. Cache rates
/// derive from the fast base input (5m=1.25x, 1h=2x, read=0.1x), same as the
/// standard tiers. Official fast pricing (verified 2026-06-10):
/// Opus 4.8 = $10/$50; Opus 4.6/4.7 = $30/$150. Fable/Sonnet/Haiku have no
/// fast tier — `speed:"fast"` shouldn't appear for them, and resolve falls
/// back to standard if it ever does.
fn resolve_fast(model: &str) -> Option<Pricing> {
    let opus_48_fast = Pricing {
        input: 10.0,
        output: 50.0,
        cache_write_5m: 12.5,
        cache_write_1h: 20.0,
        cache_read: 1.0,
    };
    let opus_67_fast = Pricing {
        input: 30.0,
        output: 150.0,
        cache_write_5m: 37.5,
        cache_write_1h: 60.0,
        cache_read: 3.0,
    };
    // Boundary-checked prefix match (same rule as resolve_uncached): the base
    // must be followed by end-of-string or '-' so a date suffix matches but a
    // hypothetical `claude-opus-48` would not.
    for (base, pricing) in [
        ("claude-opus-4-8", opus_48_fast),
        ("claude-opus-4-7", opus_67_fast),
        ("claude-opus-4-6", opus_67_fast),
    ] {
        if model == base
            || model
                .strip_prefix(base)
                .map_or(false, |rest| rest.starts_with('-'))
        {
            return Some(pricing);
        }
    }
    None
}

#[derive(Default, Clone)]
pub struct UsageTokens {
    pub input: u64,
    pub output: u64,
    pub cache_creation_5m: u64,
    pub cache_creation_1h: u64,
    pub cache_read: u64,
    /// Server-side web search calls — billed per request, not as tokens.
    pub web_search_requests: u64,
    /// `inference_geo == "us"` → 1.1x on token costs.
    pub inference_geo_us: bool,
    /// `speed == "fast"` → fast-mode pricing on supported Opus models.
    pub speed_fast: bool,
}

pub fn cost_usd(model: &str, u: &UsageTokens) -> f64 {
    // Fast mode reprices the model; fall back to standard pricing when the
    // model has no fast tier (Fable/Sonnet/Haiku) so cost is never $0 just
    // because speed was "fast".
    let resolved = if u.speed_fast {
        resolve_fast(model).or_else(|| resolve(model))
    } else {
        resolve(model)
    };
    let Some(p) = resolved else { return 0.0 };
    let mut token_cost = (u.input as f64) * p.input / 1_000_000.0
        + (u.output as f64) * p.output / 1_000_000.0
        + (u.cache_creation_5m as f64) * p.cache_write_5m / 1_000_000.0
        + (u.cache_creation_1h as f64) * p.cache_write_1h / 1_000_000.0
        + (u.cache_read as f64) * p.cache_read / 1_000_000.0;
    if u.inference_geo_us {
        token_cost *= US_INFERENCE_MULTIPLIER;
    }
    token_cost + (u.web_search_requests as f64) * WEB_SEARCH_USD_PER_REQUEST
}

pub fn family_of(model: &str) -> &'static str {
    let lower = model.to_lowercase();
    if lower.contains("fable") || lower.contains("mythos") {
        "Fable"
    } else if lower.contains("opus") {
        "Opus"
    } else if lower.contains("sonnet") {
        "Sonnet"
    } else if lower.contains("haiku") {
        "Haiku"
    } else {
        "Other"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn toks(input: u64, output: u64, c5m: u64, c1h: u64, read: u64) -> UsageTokens {
        UsageTokens {
            input,
            output,
            cache_creation_5m: c5m,
            cache_creation_1h: c1h,
            cache_read: read,
            ..Default::default()
        }
    }

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9, "expected {b}, got {a}");
    }

    #[test]
    fn opus_current_input_output() {
        // Opus 4.5/4.6/4.7 = $5 in / $25 out (regression: was $15/$75).
        approx(cost_usd("claude-opus-4-7", &toks(1_000_000, 0, 0, 0, 0)), 5.0);
        approx(cost_usd("claude-opus-4-7", &toks(0, 1_000_000, 0, 0, 0)), 25.0);
    }

    #[test]
    fn cache_5m_and_1h_priced_separately() {
        // 5m write = $6.25, 1h write = $10 for Opus current.
        approx(cost_usd("claude-opus-4-7", &toks(0, 0, 1_000_000, 0, 0)), 6.25);
        approx(cost_usd("claude-opus-4-7", &toks(0, 0, 0, 1_000_000, 0)), 10.0);
        // cache read = $0.50.
        approx(cost_usd("claude-opus-4-7", &toks(0, 0, 0, 0, 1_000_000)), 0.5);
    }

    #[test]
    fn date_suffix_resolves_to_longest_prefix() {
        // claude-opus-4-7-<date> must hit opus_current ($5), not opus_legacy ($15)
        // via the shorter `claude-opus-4` prefix.
        approx(cost_usd("claude-opus-4-7-20250416", &toks(1_000_000, 0, 0, 0, 0)), 5.0);
    }

    #[test]
    fn opus_4_8_uses_current_pricing() {
        // Opus 4.8 (released 2026-05-28) shares the current Opus tier ($5/$25),
        // not opus_legacy via the shorter `claude-opus-4` prefix. Bare id (as
        // seen in jsonl) and date-suffixed id must both resolve to $5/$25.
        approx(cost_usd("claude-opus-4-8", &toks(1_000_000, 0, 0, 0, 0)), 5.0);
        approx(cost_usd("claude-opus-4-8-20260528", &toks(0, 1_000_000, 0, 0, 0)), 25.0);
    }

    #[test]
    fn fable_5_pricing() {
        // Fable 5 (released 2026-06-09): $10 in / $50 out, cache 5m $12.50 /
        // 1h $20 / read $1. Bare id is what Claude Code jsonl records.
        approx(cost_usd("claude-fable-5", &toks(1_000_000, 0, 0, 0, 0)), 10.0);
        approx(cost_usd("claude-fable-5", &toks(0, 1_000_000, 0, 0, 0)), 50.0);
        approx(cost_usd("claude-fable-5", &toks(0, 0, 1_000_000, 0, 0)), 12.5);
        approx(cost_usd("claude-fable-5", &toks(0, 0, 0, 1_000_000, 0)), 20.0);
        approx(cost_usd("claude-fable-5", &toks(0, 0, 0, 0, 1_000_000)), 1.0);
        // Future date-suffixed variant must resolve to the same tier.
        approx(cost_usd("claude-fable-5-20260609", &toks(1_000_000, 0, 0, 0, 0)), 10.0);
    }

    #[test]
    fn mythos_5_priced_like_fable() {
        // Mythos 5 shares the Fable tier ($10/$50); not silently $0.
        approx(cost_usd("claude-mythos-5", &toks(1_000_000, 0, 0, 0, 0)), 10.0);
        approx(cost_usd("claude-mythos-5", &toks(0, 1_000_000, 0, 0, 0)), 50.0);
        assert_eq!(family_of("claude-mythos-5"), "Fable");
    }

    #[test]
    fn sonnet_5_introductory_pricing() {
        // Sonnet 5 (released 2026-06-30), introductory pricing through
        // 2026-08-31: $2 in / $10 out. Must not resolve to None -> $0: the
        // `claude-sonnet-4` entry is NOT a prefix of `claude-sonnet-5`.
        approx(cost_usd("claude-sonnet-5", &toks(1_000_000, 0, 0, 0, 0)), 2.0);
        approx(cost_usd("claude-sonnet-5", &toks(0, 1_000_000, 0, 0, 0)), 10.0);
        approx(cost_usd("claude-sonnet-5", &toks(0, 0, 1_000_000, 0, 0)), 2.5);
        approx(cost_usd("claude-sonnet-5", &toks(0, 0, 0, 1_000_000, 0)), 4.0);
        approx(cost_usd("claude-sonnet-5", &toks(0, 0, 0, 0, 1_000_000)), 0.2);
        // Date-suffixed id from JSONL resolves too.
        approx(cost_usd("claude-sonnet-5-20260630", &toks(1_000_000, 0, 0, 0, 0)), 2.0);
        assert_eq!(family_of("claude-sonnet-5"), "Sonnet");
    }

    #[test]
    fn fast_mode_reprices_opus() {
        let fast = |model: &str, input: u64, output: u64| {
            cost_usd(
                model,
                &UsageTokens {
                    input,
                    output,
                    speed_fast: true,
                    ..Default::default()
                },
            )
        };
        // Opus 4.8 fast = $10/$50 (2x standard $5/$25).
        approx(fast("claude-opus-4-8", 1_000_000, 0), 10.0);
        approx(fast("claude-opus-4-8", 0, 1_000_000), 50.0);
        // Opus 4.7 fast = $30/$150 (6x). Date-suffixed id resolves too.
        approx(fast("claude-opus-4-7", 1_000_000, 0), 30.0);
        approx(fast("claude-opus-4-7-20250416", 0, 1_000_000), 150.0);
        // Opus 4.6 fast = $30/$150.
        approx(fast("claude-opus-4-6", 1_000_000, 0), 30.0);
    }

    #[test]
    fn fast_mode_cache_rates_derive_from_fast_input() {
        // Opus 4.8 fast: 5m write = 1.25x10 = 12.5, 1h = 2x10 = 20, read = 0.1x10 = 1.
        let t = UsageTokens { cache_creation_5m: 1_000_000, speed_fast: true, ..Default::default() };
        approx(cost_usd("claude-opus-4-8", &t), 12.5);
        let t = UsageTokens { cache_creation_1h: 1_000_000, speed_fast: true, ..Default::default() };
        approx(cost_usd("claude-opus-4-8", &t), 20.0);
        let t = UsageTokens { cache_read: 1_000_000, speed_fast: true, ..Default::default() };
        approx(cost_usd("claude-opus-4-8", &t), 1.0);
    }

    #[test]
    fn fast_mode_falls_back_to_standard_for_non_fast_models() {
        // Fable/Sonnet have no fast tier — speed_fast must not zero them out;
        // fall back to standard pricing.
        let t = UsageTokens { input: 1_000_000, speed_fast: true, ..Default::default() };
        approx(cost_usd("claude-sonnet-4-6", &t), 3.0); // standard sonnet input
        approx(cost_usd("claude-fable-5", &t), 10.0); // standard fable input
    }

    #[test]
    fn standard_speed_unaffected_by_fast_logic() {
        // speed_fast=false must keep standard Opus pricing.
        approx(cost_usd("claude-opus-4-8", &toks(1_000_000, 0, 0, 0, 0)), 5.0);
    }

    #[test]
    fn deprecated_opus_uses_legacy_pricing() {
        approx(cost_usd("claude-opus-4-20250514", &toks(1_000_000, 0, 0, 0, 0)), 15.0);
        approx(cost_usd("claude-opus-4-1", &toks(1_000_000, 0, 0, 0, 0)), 15.0);
    }

    #[test]
    fn deprecated_sonnet4_not_zero_cost() {
        // Regression: claude-sonnet-4-<date> resolved to None -> $0 before the fix.
        approx(cost_usd("claude-sonnet-4-20250514", &toks(1_000_000, 0, 0, 0, 0)), 3.0);
    }

    #[test]
    fn haiku_date_suffix_real_jsonl_id() {
        // Exact model id observed in the user's jsonl.
        approx(cost_usd("claude-haiku-4-5-20251001", &toks(1_000_000, 0, 0, 0, 0)), 1.0);
    }

    #[test]
    fn partial_match_rejected() {
        // A hypothetical future `claude-opus-40-…` must NOT match `claude-opus-4`.
        assert!(resolve("claude-opus-40-foo").is_none());
    }

    #[test]
    fn unknown_model_is_zero() {
        approx(cost_usd("gpt-4", &toks(1_000_000, 1_000_000, 0, 0, 0)), 0.0);
    }

    #[test]
    fn family_classification() {
        assert_eq!(family_of("claude-fable-5"), "Fable");
        assert_eq!(family_of("claude-opus-4-7"), "Opus");
        assert_eq!(family_of("claude-sonnet-4-6"), "Sonnet");
        assert_eq!(family_of("claude-haiku-4-5-20251001"), "Haiku");
        assert_eq!(family_of("gpt-4"), "Other");
    }

    #[test]
    fn web_search_billed_per_request() {
        let mut t = toks(0, 0, 0, 0, 0);
        t.web_search_requests = 1000;
        approx(cost_usd("claude-opus-4-7", &t), 10.0); // $10 / 1,000
    }

    #[test]
    fn inference_geo_us_multiplies_token_cost() {
        let mut t = toks(1_000_000, 0, 0, 0, 0);
        t.inference_geo_us = true;
        approx(cost_usd("claude-opus-4-7", &t), 5.5); // $5 × 1.1
    }

    #[test]
    fn inference_geo_us_does_not_touch_web_search() {
        let mut t = toks(0, 0, 0, 0, 0);
        t.web_search_requests = 1000;
        t.inference_geo_us = true;
        // token cost 0 → ×1.1 still 0; web search $10 unaffected.
        approx(cost_usd("claude-opus-4-7", &t), 10.0);
    }
}
