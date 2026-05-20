use once_cell::sync::Lazy;
use std::collections::HashMap;

#[derive(Clone, Copy)]
pub struct Pricing {
    pub input: f64,
    pub output: f64,
    pub cache_write_5m: f64,
    // 현재 `cost_usd`는 cache_creation을 모두 5m 단가로 계산. 1h 단가는
    // Anthropic 공식 가격 테이블의 일부로 보존 — jsonl에 1h/5m 구분이
    // 들어오면 활성화.
    #[allow(dead_code)]
    pub cache_write_1h: f64,
    pub cache_read: f64,
}

/// USD per million tokens.
/// Mirrors PRICING_USD_PER_MTOK in Source/_shared.py — keep in sync when the
/// official Anthropic pricing changes.
pub static PRICING: Lazy<HashMap<&'static str, Pricing>> = Lazy::new(|| {
    let opus = Pricing {
        input: 15.0,
        output: 75.0,
        cache_write_5m: 18.75,
        cache_write_1h: 30.0,
        cache_read: 1.5,
    };
    let sonnet = Pricing {
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
    m.insert("claude-opus-4-7", opus);
    m.insert("claude-opus-4-6", opus);
    m.insert("claude-opus-4-5", opus);
    m.insert("claude-sonnet-4-6", sonnet);
    m.insert("claude-sonnet-4-5", sonnet);
    m.insert("claude-haiku-4-5", haiku_45);
    m.insert("claude-3-7-sonnet-latest", sonnet);
    m.insert("claude-3-5-sonnet-latest", sonnet);
    m.insert("claude-3-5-haiku-latest", haiku_35);
    m
});

/// jsonl `model` values sometimes include a date suffix
/// (e.g. `claude-haiku-4-5-20251001`). Fall back to prefix match.
pub fn resolve(model: &str) -> Option<Pricing> {
    if let Some(p) = PRICING.get(model) {
        return Some(*p);
    }
    for (base, pricing) in PRICING.iter() {
        if model.starts_with(base) {
            return Some(*pricing);
        }
    }
    None
}

#[derive(Default, Clone)]
pub struct UsageTokens {
    pub input: u64,
    pub output: u64,
    pub cache_creation: u64,
    pub cache_read: u64,
}

pub fn cost_usd(model: &str, u: &UsageTokens) -> f64 {
    let Some(p) = resolve(model) else { return 0.0 };
    (u.input as f64) * p.input / 1_000_000.0
        + (u.output as f64) * p.output / 1_000_000.0
        + (u.cache_creation as f64) * p.cache_write_5m / 1_000_000.0
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
