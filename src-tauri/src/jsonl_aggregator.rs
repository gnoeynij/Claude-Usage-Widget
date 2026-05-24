use anyhow::Result;
use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};
use once_cell::sync::Lazy;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;
use walkdir::WalkDir;

use crate::pricing::{cost_usd, family_of, UsageTokens};

const SESSION_BLOCK_HOURS: i64 = 5;
const RECENT_BLOCKS: usize = 5;

/// Per-file cache so we don't re-parse jsonl files whose mtime hasn't
/// changed since the last aggregate() call. Heavy Claude Code users
/// accumulate gigabytes under ~/.claude/projects/ and a full re-walk on
/// every Detail-mode sync was the dominant cost. Memory cost is bounded
/// by the dataset size — same as if we always held it in memory.
struct CachedFile {
    mtime: SystemTime,
    records: Vec<Record>,
}

static FILE_CACHE: Lazy<Mutex<HashMap<PathBuf, CachedFile>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn projects_root() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("projects"))
}

#[derive(Clone)]
struct Record {
    ts: DateTime<Utc>,
    model: String,
    tokens: UsageTokens,
}

struct Block {
    start: DateTime<Utc>,
    cost: f64,
}

#[derive(Serialize, Default)]
pub struct ActiveOut {
    pub start: String,
    pub cost_usd: f64,
    pub elapsed_min: i64,
    pub remaining_min: i64,
    pub total_min: i64,
}

#[derive(Serialize, Default)]
pub struct PeriodsOut {
    pub today_cost: f64,
    pub yesterday_cost: f64,
    pub week_cost: f64,
    pub month_cost: f64,
}

#[derive(Serialize)]
pub struct BlockOut {
    pub start: String,
    pub cost_usd: f64,
}

#[derive(Serialize)]
pub struct FamilyOut {
    pub family: String,
    pub cost: f64,
    pub tokens: u64,
}

#[derive(Serialize, Default)]
pub struct StatsOut {
    pub total_cost: f64,
    pub total_messages: u64,
    pub avg_block_cost: f64,
    pub cache_hit_pct: f64,
}

#[derive(Serialize, Default)]
pub struct AggregateOut {
    pub active: Option<ActiveOut>,
    pub peak_block_cost: f64,
    pub periods: PeriodsOut,
    pub recent: Vec<BlockOut>,
    pub by_family: Vec<FamilyOut>,
    pub stats: StatsOut,
}

pub fn aggregate() -> Result<AggregateOut> {
    let root = match projects_root() {
        Some(p) if p.exists() => p,
        Some(p) => {
            log::warn!("aggregate: projects_root does not exist: {}", p.display());
            return Ok(AggregateOut::default());
        }
        _ => {
            log::warn!("aggregate: home_dir() unavailable");
            return Ok(AggregateOut::default());
        }
    };

    let mut records = collect_records(&root);
    records.sort_by_key(|r| r.ts);

    let blocks = group_blocks(&records);
    let now = Utc::now();
    let active = active_view(&blocks, now, &records);
    log::info!(
        "aggregate: root={} records={} blocks={} active={}",
        root.display(),
        records.len(),
        blocks.len(),
        active.is_some()
    );

    Ok(AggregateOut {
        active,
        peak_block_cost: blocks
            .iter()
            .map(|b| b.cost)
            .fold(0.0_f64, f64::max),
        periods: period_totals(&records),
        recent: recent_blocks(&blocks),
        by_family: family_totals(&records),
        stats: overall_stats(&records, &blocks),
    })
}

fn parse_jsonl(path: &Path) -> Vec<Record> {
    let mut out = Vec::new();
    let Ok(text) = std::fs::read_to_string(path) else {
        return out;
    };
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            continue;
        };
        let Some(msg) = value.get("message").and_then(|m| m.as_object()) else {
            continue;
        };
        if msg.get("role").and_then(|r| r.as_str()) != Some("assistant") {
            continue;
        }
        let Some(usage) = msg.get("usage").and_then(|u| u.as_object()) else {
            continue;
        };
        let Some(ts_str) = value.get("timestamp").and_then(|t| t.as_str()) else {
            continue;
        };
        let Ok(ts) = DateTime::parse_from_rfc3339(ts_str) else {
            continue;
        };
        let model = msg
            .get("model")
            .and_then(|m| m.as_str())
            .unwrap_or("")
            .to_string();
        if model.is_empty() {
            continue;
        }
        out.push(Record {
            ts: ts.with_timezone(&Utc),
            model,
            tokens: UsageTokens {
                input: usage.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0),
                output: usage.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0),
                cache_creation: usage
                    .get("cache_creation_input_tokens")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0),
                cache_read: usage
                    .get("cache_read_input_tokens")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0),
            },
        });
    }
    out
}

fn collect_records(root: &Path) -> Vec<Record> {
    let start = std::time::Instant::now();
    let mut cache = FILE_CACHE.lock().expect("FILE_CACHE poisoned");
    let mut seen: Vec<PathBuf> = Vec::new();
    let mut out: Vec<Record> = Vec::new();
    let mut hits = 0usize;
    let mut misses = 0usize;

    for entry in WalkDir::new(root).into_iter().filter_map(Result::ok) {
        if !entry.file_type().is_file() {
            continue;
        }
        if entry.path().extension().and_then(|s| s.to_str()) != Some("jsonl") {
            continue;
        }
        let path = entry.path().to_path_buf();
        let mtime = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .unwrap_or(SystemTime::UNIX_EPOCH);

        let records = if let Some(cached) = cache.get(&path) {
            if cached.mtime == mtime {
                hits += 1;
                cached.records.clone()
            } else {
                misses += 1;
                let fresh = parse_jsonl(&path);
                cache.insert(path.clone(), CachedFile { mtime, records: fresh.clone() });
                fresh
            }
        } else {
            misses += 1;
            let fresh = parse_jsonl(&path);
            cache.insert(path.clone(), CachedFile { mtime, records: fresh.clone() });
            fresh
        };
        out.extend(records);
        seen.push(path);
    }

    // Drop entries for files that no longer exist (project deleted, session
    // archived, etc.) so the cache doesn't grow unbounded.
    let seen_set: std::collections::HashSet<_> = seen.iter().collect();
    cache.retain(|k, _| seen_set.contains(k));

    // Total records currently cached — a rough proxy for memory footprint.
    // 1 record ≈ 50-100 B (UsageTokens 4×u64 + DateTime + model String), so
    // a million records is ~50-100 MB. Useful for spotting cache bloat in
    // heavy-user bug reports without instrumenting allocation.
    let cache_records: usize = cache.values().map(|c| c.records.len()).sum();
    log::info!(
        "aggregate: scanned {} files (cache hits={} misses={} cached_records={}) in {}ms",
        seen.len(),
        hits,
        misses,
        cache_records,
        start.elapsed().as_millis(),
    );
    out
}

fn group_blocks(records: &[Record]) -> Vec<Block> {
    let mut blocks: Vec<Block> = Vec::new();
    for r in records {
        let cost = cost_usd(&r.model, &r.tokens);
        if let Some(last) = blocks.last_mut() {
            if (r.ts - last.start).num_hours() < SESSION_BLOCK_HOURS {
                last.cost += cost;
                continue;
            }
        }
        blocks.push(Block { start: r.ts, cost });
    }
    blocks
}

fn active_view(
    blocks: &[Block],
    now: DateTime<Utc>,
    _records: &[Record],
) -> Option<ActiveOut> {
    let last = blocks.last()?;
    let elapsed = now - last.start;
    if elapsed.num_hours() >= SESSION_BLOCK_HOURS {
        return None;
    }
    let total = Duration::hours(SESSION_BLOCK_HOURS);
    let remaining = total - elapsed;
    Some(ActiveOut {
        start: last.start.to_rfc3339(),
        cost_usd: last.cost,
        elapsed_min: elapsed.num_minutes(),
        remaining_min: remaining.num_minutes().max(0),
        total_min: total.num_minutes(),
    })
}

fn period_totals(records: &[Record]) -> PeriodsOut {
    let local_today = chrono::Local::now().date_naive();
    let yesterday = local_today.pred_opt().unwrap_or(local_today);
    let weekday = local_today.weekday().num_days_from_monday() as i64;
    let week_start = local_today - Duration::days(weekday);
    let month_start =
        NaiveDate::from_ymd_opt(local_today.year(), local_today.month(), 1).unwrap_or(local_today);

    let mut out = PeriodsOut::default();
    for r in records {
        let local_dt = r.ts.with_timezone(&chrono::Local);
        let date = local_dt.date_naive();
        let cost = cost_usd(&r.model, &r.tokens);
        if date == local_today {
            out.today_cost += cost;
        }
        if date == yesterday {
            out.yesterday_cost += cost;
        }
        if date >= week_start && date <= local_today {
            out.week_cost += cost;
        }
        if date >= month_start && date <= local_today {
            out.month_cost += cost;
        }
    }
    out
}

fn recent_blocks(blocks: &[Block]) -> Vec<BlockOut> {
    blocks
        .iter()
        .rev()
        .take(RECENT_BLOCKS)
        .map(|b| BlockOut {
            start: b.start.to_rfc3339(),
            cost_usd: b.cost,
        })
        .collect()
}

fn family_totals(records: &[Record]) -> Vec<FamilyOut> {
    let mut acc: HashMap<&'static str, (f64, u64)> = HashMap::new();
    for r in records {
        let cost = cost_usd(&r.model, &r.tokens);
        let toks = r.tokens.input
            + r.tokens.output
            + r.tokens.cache_creation
            + r.tokens.cache_read;
        let entry = acc.entry(family_of(&r.model)).or_insert((0.0, 0));
        entry.0 += cost;
        entry.1 += toks;
    }
    let mut out: Vec<FamilyOut> = acc
        .into_iter()
        .map(|(family, (cost, tokens))| FamilyOut {
            family: family.to_string(),
            cost,
            tokens,
        })
        .collect();
    out.sort_by(|a, b| b.cost.partial_cmp(&a.cost).unwrap_or(std::cmp::Ordering::Equal));
    out
}

fn overall_stats(records: &[Record], blocks: &[Block]) -> StatsOut {
    let total_messages = records.len() as u64;
    let total_cost: f64 = records.iter().map(|r| cost_usd(&r.model, &r.tokens)).sum();
    let avg_block_cost = if blocks.is_empty() {
        0.0
    } else {
        total_cost / blocks.len() as f64
    };
    let total_input: u64 = records.iter().map(|r| r.tokens.input).sum();
    let total_cache_creation: u64 = records.iter().map(|r| r.tokens.cache_creation).sum();
    let total_cache_read: u64 = records.iter().map(|r| r.tokens.cache_read).sum();
    let billed_input = total_input + total_cache_creation + total_cache_read;
    let cache_hit_pct = if billed_input == 0 {
        0.0
    } else {
        (total_cache_read as f64 / billed_input as f64) * 100.0
    };
    StatsOut {
        total_cost,
        total_messages,
        avg_block_cost,
        cache_hit_pct,
    }
}
