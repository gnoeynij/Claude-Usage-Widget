use once_cell::sync::Lazy;
use std::collections::HashMap;

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
/// (last verified 2026-05-28). When Anthropic ships a new model generation,
/// add an entry below and re-verify the existing ones.
pub static PRICING: Lazy<HashMap<&'static str, Pricing>> = Lazy::new(|| {
    let opus_current = Pricing {
        // Opus 4.5 / 4.6 / 4.7 — same price tier.
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
    m.insert("claude-opus-4-7", opus_current);
    m.insert("claude-opus-4-6", opus_current);
    m.insert("claude-opus-4-5", opus_current);
    m.insert("claude-opus-4-1", opus_legacy);
    m.insert("claude-opus-4", opus_legacy);
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
pub fn resolve(model: &str) -> Option<Pricing> {
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
}

pub fn cost_usd(model: &str, u: &UsageTokens) -> f64 {
    let Some(p) = resolve(model) else { return 0.0 };
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
    if lower.contains("opus") {
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
