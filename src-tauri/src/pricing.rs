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

#[derive(Default, Clone)]
pub struct UsageTokens {
    pub input: u64,
    pub output: u64,
    pub cache_creation_5m: u64,
    pub cache_creation_1h: u64,
    pub cache_read: u64,
}

pub fn cost_usd(model: &str, u: &UsageTokens) -> f64 {
    let Some(p) = resolve(model) else { return 0.0 };
    (u.input as f64) * p.input / 1_000_000.0
        + (u.output as f64) * p.output / 1_000_000.0
        + (u.cache_creation_5m as f64) * p.cache_write_5m / 1_000_000.0
        + (u.cache_creation_1h as f64) * p.cache_write_1h / 1_000_000.0
        + (u.cache_read as f64) * p.cache_read / 1_000_000.0
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
