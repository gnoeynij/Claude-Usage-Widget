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
/// (last verified 2026-09-28 against that page). When Anthropic ships
/// a new model generation, add an entry below and re-verify the existing ones.
pub static PRICING: Lazy<HashMap<&'static str, Pricing>> = Lazy::new(|| {
    let fable = Pricing {
        // Fable 5 — Mythos-class tier above Opus (released 2026-06-09).
        input: 10.0,
        output: 50.0,
        cache_write_5m: 12.5,
        cache_write_1h: 20.0,
        cache_read: 1.0,
    };
    let fable_51 = Pricing {
        // Fable 5.1 / Mythos 5.1 (released 2026-09-01). Same $10/$50 tier as
        // Fable 5, but cache reads are 0.025x base input instead of the
        // universal 0.1x — the only models that break that rule. The map
        // entries are load-bearing: without them `claude-fable-5-1` prefix-
        // matches `claude-fable-5` and prices cache reads 4x too high.
        input: 10.0,
        output: 50.0,
        cache_write_5m: 12.5,
        cache_write_1h: 20.0,
        cache_read: 0.25,
    };
    let opus_5_5 = Pricing {
        // Opus 5.5 (released 2026-09). Cheaper than Opus 5 in every category,
        // and cache reads are 0.05x base input ($0.20) rather than the
        // universal 0.1x — the second family after Fable/Mythos 5.1 to break
        // that rule. The map entry is load-bearing: without it
        // `claude-opus-5-5` prefix-matches `claude-opus-5` and prices cache
        // reads 2.5x too high (every other category 1.25x too high).
        input: 4.0,
        output: 20.0,
        cache_write_5m: 5.0,
        cache_write_1h: 8.0,
        cache_read: 0.2,
    };
    let opus_current = Pricing {
        // Opus 4.5 / 4.6 / 4.7 / 4.8 / 5 — same price tier. Opus 5 (released
        // 2026-07) is a drop-in at Opus 4.8's pricing per the official table.
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
        // Sonnet 5 (released 2026-06-30). $2/$10 launched as introductory
        // pricing through 2026-08-31, but Anthropic made it permanent on
        // 2026-08-10 — the scheduled 2026-09-01 rise to $3/$15 will not
        // happen, so do NOT merge this into the `sonnet` tier.
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
    m.insert("claude-fable-5-1", fable_51);
    m.insert("claude-opus-5-5", opus_5_5);
    // Opus 5 — `claude-opus-4` is NOT a prefix of `claude-opus-5`, so without
    // this entry resolve() returned None and every Opus 5 record counted $0
    // (observed live 2026-07-28: 1.3k+ such records in a week of JSONL).
    m.insert("claude-opus-5", opus_current);
    // Mythos 5 — same Mythos-class tier/price as Fable 5 ($10/$50). Limited
    // availability (Project Glasswing), so it won't normally appear in Claude
    // Code JSONL, but priced here so it isn't silently counted as $0.
    m.insert("claude-mythos-5", fable);
    m.insert("claude-mythos-5-1", fable_51);
    m.insert("claude-opus-4-8", opus_current);
    m.insert("claude-opus-4-7", opus_current);
    m.insert("claude-opus-4-6", opus_current);
    m.insert("claude-opus-4-5", opus_current);
    m.insert("claude-opus-4-1", opus_legacy);
    m.insert("claude-opus-4", opus_legacy);
    // Sonnet 5.5 — same price as Sonnet 5 in all five columns (verified
    // 2026-10-07); listed explicitly so a future price split can't hide behind
    // the `claude-sonnet-5` prefix match (§25/§26).
    m.insert("claude-sonnet-5-5", sonnet_5);
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
/// derive from the fast base input (5m=1.25x, 1h=2x) with the model's own
/// cache-read multiplier — 0.1x everywhere except Opus 5.5, which is 0.05x
/// like its standard tier. Official fast pricing (verified 2026-09-28):
/// Opus 5.5 = $8/$40, Opus 5 / 4.8 = $10/$50. Opus 4.7 now rejects
/// `speed:"fast"` outright so no new records can appear — its $30/$150 tier
/// stays for historical JSONL. Opus 4.6 is dropped: the docs say those
/// requests run at standard speed and are billed at standard rates, so they
/// must fall through to `resolve()`.
/// Fable/Sonnet/Haiku have no fast tier — `speed:"fast"` shouldn't appear for
/// them, and resolve falls back to standard if it ever does.
fn resolve_fast(model: &str) -> Option<Pricing> {
    let opus_5_48_fast = Pricing {
        input: 10.0,
        output: 50.0,
        cache_write_5m: 12.5,
        cache_write_1h: 20.0,
        cache_read: 1.0,
    };
    let opus_55_fast = Pricing {
        input: 8.0,
        output: 40.0,
        cache_write_5m: 10.0,
        cache_write_1h: 16.0,
        cache_read: 0.4,
    };
    let opus_47_fast = Pricing {
        input: 30.0,
        output: 150.0,
        cache_write_5m: 37.5,
        cache_write_1h: 60.0,
        cache_read: 3.0,
    };
    // Boundary-checked prefix match (same rule as resolve_uncached): the base
    // must be followed by end-of-string or '-' so a date suffix matches but a
    // hypothetical `claude-opus-48` would not.
    // Order matters: this returns the FIRST match, not the longest, so more
    // specific ids must come first — `claude-opus-5-5` also matches the
    // `claude-opus-5` base under the boundary rule below.
    for (base, pricing) in [
        ("claude-opus-5-5", opus_55_fast),
        ("claude-opus-5", opus_5_48_fast),
        ("claude-opus-4-8", opus_5_48_fast),
        ("claude-opus-4-7", opus_47_fast),
    ] {
        if model == base
            || model
                .strip_prefix(base)
                .is_some_and(|rest| rest.starts_with('-'))
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
    fn opus_5_uses_current_pricing_not_zero() {
        // Regression guard: `claude-opus-4` is not a prefix of `claude-opus-5`,
        // so before the entry was added Opus 5 records silently cost $0.
        // Official (2026-07-28): $5/$25, cache 6.25/10/0.5 — same as Opus 4.8.
        approx(cost_usd("claude-opus-5", &toks(1_000_000, 0, 0, 0, 0)), 5.0);
        approx(cost_usd("claude-opus-5", &toks(0, 1_000_000, 0, 0, 0)), 25.0);
        approx(cost_usd("claude-opus-5", &toks(0, 0, 1_000_000, 0, 0)), 6.25);
        approx(cost_usd("claude-opus-5", &toks(0, 0, 0, 1_000_000, 0)), 10.0);
        approx(cost_usd("claude-opus-5", &toks(0, 0, 0, 0, 1_000_000)), 0.5);
        // Future date-suffixed id resolves to the same tier; family is Opus.
        approx(cost_usd("claude-opus-5-20260715", &toks(1_000_000, 0, 0, 0, 0)), 5.0);
        assert_eq!(family_of("claude-opus-5"), "Opus");
    }

    #[test]
    fn opus_5_fast_mode_2x() {
        // Opus 5 fast = $10/$50 (2x standard), same tier as Opus 4.8 fast.
        let t = UsageTokens { input: 1_000_000, speed_fast: true, ..Default::default() };
        approx(cost_usd("claude-opus-5", &t), 10.0);
        let t = UsageTokens { output: 1_000_000, speed_fast: true, ..Default::default() };
        approx(cost_usd("claude-opus-5", &t), 50.0);
        let t = UsageTokens { cache_creation_5m: 1_000_000, speed_fast: true, ..Default::default() };
        approx(cost_usd("claude-opus-5", &t), 12.5);
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
    fn fable_5_1_and_mythos_5_1_have_cheaper_cache_reads() {
        // Released 2026-09-01. Input/output/cache writes match Fable 5, but
        // cache reads are 0.025x base input ($0.25) instead of 0.1x ($1).
        // Without their own entries these ids prefix-match `claude-fable-5`
        // and overprice cache reads 4x — that silent path is what this guards.
        for id in ["claude-fable-5-1", "claude-mythos-5-1", "claude-fable-5-1-20260901"] {
            approx(cost_usd(id, &toks(1_000_000, 0, 0, 0, 0)), 10.0);
            approx(cost_usd(id, &toks(0, 1_000_000, 0, 0, 0)), 50.0);
            approx(cost_usd(id, &toks(0, 0, 1_000_000, 0, 0)), 12.5);
            approx(cost_usd(id, &toks(0, 0, 0, 1_000_000, 0)), 20.0);
            approx(cost_usd(id, &toks(0, 0, 0, 0, 1_000_000)), 0.25);
            assert_eq!(family_of(id), "Fable");
        }
        // Fable 5 keeps the old $1 cache read.
        approx(cost_usd("claude-fable-5", &toks(0, 0, 0, 0, 1_000_000)), 1.0);
    }

    #[test]
    fn opus_5_5_has_its_own_cheaper_tier() {
        // Opus 5.5: $4/$20, and cache reads are 0.05x base input ($0.20)
        // rather than the universal 0.1x. Without its own entry
        // `claude-opus-5-5` prefix-matches `claude-opus-5` and silently
        // prices every category 1.25x too high — cache reads 2.5x too high.
        // The second id is a date-suffix shape, not a specific release date.
        for id in ["claude-opus-5-5", "claude-opus-5-5-20260101"] {
            approx(cost_usd(id, &toks(1_000_000, 0, 0, 0, 0)), 4.0);
            approx(cost_usd(id, &toks(0, 1_000_000, 0, 0, 0)), 20.0);
            approx(cost_usd(id, &toks(0, 0, 1_000_000, 0, 0)), 5.0);
            approx(cost_usd(id, &toks(0, 0, 0, 1_000_000, 0)), 8.0);
            approx(cost_usd(id, &toks(0, 0, 0, 0, 1_000_000)), 0.2);
            assert_eq!(family_of(id), "Opus");
        }
        // Opus 5 keeps its own tier.
        approx(cost_usd("claude-opus-5", &toks(1_000_000, 0, 0, 0, 0)), 5.0);
        approx(cost_usd("claude-opus-5", &toks(0, 0, 0, 0, 1_000_000)), 0.5);

        // Fast mode: $8/$40, with cache reads still at 0.05x the fast base
        // input ($0.40). resolve_fast returns the first match, so this also
        // guards the ordering against the `claude-opus-5` entry.
        let fast = |model: &str, u: UsageTokens| {
            cost_usd(
                model,
                &UsageTokens {
                    speed_fast: true,
                    ..u
                },
            )
        };
        approx(fast("claude-opus-5-5", toks(1_000_000, 0, 0, 0, 0)), 8.0);
        approx(fast("claude-opus-5-5", toks(0, 1_000_000, 0, 0, 0)), 40.0);
        approx(fast("claude-opus-5-5", toks(0, 0, 0, 0, 1_000_000)), 0.4);
        // Opus 5 fast stays $10/$50.
        approx(fast("claude-opus-5", toks(1_000_000, 0, 0, 0, 0)), 10.0);
    }

    #[test]
    fn sonnet_5_pricing() {
        // Sonnet 5 (released 2026-06-30): $2 in / $10 out — the launch price,
        // made permanent 2026-08-10 (the 2026-09-01 rise to $3/$15 was
        // cancelled). Must not resolve to None -> $0: the `claude-sonnet-4`
        // entry is NOT a prefix of `claude-sonnet-5`.
        approx(cost_usd("claude-sonnet-5", &toks(1_000_000, 0, 0, 0, 0)), 2.0);
        approx(cost_usd("claude-sonnet-5", &toks(0, 1_000_000, 0, 0, 0)), 10.0);
        approx(cost_usd("claude-sonnet-5", &toks(0, 0, 1_000_000, 0, 0)), 2.5);
        approx(cost_usd("claude-sonnet-5", &toks(0, 0, 0, 1_000_000, 0)), 4.0);
        approx(cost_usd("claude-sonnet-5", &toks(0, 0, 0, 0, 1_000_000)), 0.2);
        // Date-suffixed id from JSONL resolves too.
        approx(cost_usd("claude-sonnet-5-20260630", &toks(1_000_000, 0, 0, 0, 0)), 2.0);
        assert_eq!(family_of("claude-sonnet-5"), "Sonnet");
        approx(cost_usd("claude-sonnet-5-5", &toks(1_000_000, 0, 0, 0, 0)), 2.0);
        approx(cost_usd("claude-sonnet-5-5", &toks(0, 0, 0, 0, 1_000_000)), 0.2);
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
        // Opus 4.6 has no fast tier: the API runs those requests at standard
        // speed and bills standard rates, so it must fall back to $5/$25.
        approx(fast("claude-opus-4-6", 1_000_000, 0), 5.0);
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
