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

#[derive(Serialize)]
pub struct DayFamilyOut {
    pub family: String,
    pub cost: f64,
    pub tokens: u64,
}

/// One local calendar day, broken down by model family. Emitted only for days
/// still present on disk; the frontend folds these into a durable, non-volatile
/// `costHistory` (max-merge per day+family) so the breakdown survives Claude
/// Code's `cleanupPeriodDays` JSONL deletion. Presentation-agnostic on purpose
/// — daily×family is a clean base for later charts/stats.
#[derive(Serialize)]
pub struct DayOut {
    pub date: String, // local "YYYY-MM-DD"
    pub cost: f64,
    pub tokens: u64,
    pub families: Vec<DayFamilyOut>,
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
    /// Cost of records newer than the caller's `counted_until_ms` — lets the
    /// frontend keep a non-decreasing lifetime total without re-summing
    /// already-counted records (so it survives later JSONL log cleanup).
    pub new_cost_since: f64,
    /// Newest record timestamp in ms (or `counted_until_ms` if none is newer);
    /// the frontend stores this back as the next `counted_until_ms`.
    pub max_ts_ms: f64,
    /// Per-day × per-family rollup for days still on disk. Frontend max-merges
    /// these into a durable `costHistory` so the breakdown outlives JSONL cleanup.
    pub daily: Vec<DayOut>,
}

pub fn aggregate(counted_until_ms: f64) -> Result<AggregateOut> {
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

    // Lifetime delta: cost of records newer than what the caller already
    // folded in, plus the newest timestamp seen. Lets the frontend keep a
    // non-decreasing lifetime total. resolve() is memoized so this extra pass
    // is cheap even for heavy users.
    let mut new_cost_since = 0.0_f64;
    let mut max_ts_ms = counted_until_ms;
    for r in &records {
        let ms = r.ts.timestamp_millis() as f64;
        if ms > counted_until_ms {
            new_cost_since += cost_usd(&r.model, &r.tokens);
        }
        if ms > max_ts_ms {
            max_ts_ms = ms;
        }
    }

    let blocks = group_blocks(&records);
    let now = Utc::now();
    let active = active_view(&blocks, now);
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
        new_cost_since,
        max_ts_ms,
        daily: daily_totals(&records),
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
        // "<synthetic>" marks Claude Code placeholder turns (no API call, zero
        // usage). Skip them so they don't inflate the message count or anchor a
        // phantom $0 session block.
        if model == "<synthetic>" {
            continue;
        }
        // Anthropic split cache creation into 5m vs 1h ephemeral buckets when
        // the 1h cache went GA (2025-08-13). Newer rows carry the nested
        // `cache_creation` object; older rows only have the flat
        // `cache_creation_input_tokens` total — fall back by attributing all
        // of it to 5m, which matches the only cache duration available before
        // the split.
        let (cache_5m, cache_1h) = if let Some(obj) =
            usage.get("cache_creation").and_then(|v| v.as_object())
        {
            let m5 = obj
                .get("ephemeral_5m_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let h1 = obj
                .get("ephemeral_1h_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            (m5, h1)
        } else {
            let flat = usage
                .get("cache_creation_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            (flat, 0)
        };
        let web_search_requests = usage
            .get("server_tool_use")
            .and_then(|v| v.as_object())
            .and_then(|o| o.get("web_search_requests"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let inference_geo_us = usage
            .get("inference_geo")
            .and_then(|v| v.as_str())
            .map(|s| s.eq_ignore_ascii_case("us"))
            .unwrap_or(false);
        // Fast mode (Opus only) bills 2–6x; without this the cost would be
        // under-counted at standard rates. All records seen so far are
        // "standard", so this is a forward guard.
        let speed_fast = usage
            .get("speed")
            .and_then(|v| v.as_str())
            .map(|s| s.eq_ignore_ascii_case("fast"))
            .unwrap_or(false);
        out.push(Record {
            ts: ts.with_timezone(&Utc),
            model,
            tokens: UsageTokens {
                input: usage.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0),
                output: usage.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0),
                cache_creation_5m: cache_5m,
                cache_creation_1h: cache_1h,
                cache_read: usage
                    .get("cache_read_input_tokens")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0),
                web_search_requests,
                inference_geo_us,
                speed_fast,
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

fn active_view(blocks: &[Block], now: DateTime<Utc>) -> Option<ActiveOut> {
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

/// Per-local-day × per-family rollup. Bucketed by each record's timestamp
/// converted to the local date (deterministic given the record ts — no
/// `now()` dependency, unlike period_totals). Days are returned oldest-first.
fn daily_totals(records: &[Record]) -> Vec<DayOut> {
    // date -> family -> (cost, tokens)
    let mut acc: HashMap<String, HashMap<&'static str, (f64, u64)>> = HashMap::new();
    for r in records {
        let date = r
            .ts
            .with_timezone(&chrono::Local)
            .date_naive()
            .format("%Y-%m-%d")
            .to_string();
        let cost = cost_usd(&r.model, &r.tokens);
        let toks = r.tokens.input
            + r.tokens.output
            + r.tokens.cache_creation_5m
            + r.tokens.cache_creation_1h
            + r.tokens.cache_read;
        let fam = acc.entry(date).or_default().entry(family_of(&r.model)).or_insert((0.0, 0));
        fam.0 += cost;
        fam.1 += toks;
    }
    let mut days: Vec<DayOut> = acc
        .into_iter()
        .map(|(date, fams)| {
            let mut families: Vec<DayFamilyOut> = fams
                .into_iter()
                .map(|(family, (cost, tokens))| DayFamilyOut {
                    family: family.to_string(),
                    cost,
                    tokens,
                })
                .collect();
            families.sort_by(|a, b| b.cost.total_cmp(&a.cost));
            DayOut {
                cost: families.iter().map(|f| f.cost).sum(),
                tokens: families.iter().map(|f| f.tokens).sum(),
                date,
                families,
            }
        })
        .collect();
    days.sort_by(|a, b| a.date.cmp(&b.date));
    days
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
            + r.tokens.cache_creation_5m
            + r.tokens.cache_creation_1h
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
    let total_cache_creation: u64 = records
        .iter()
        .map(|r| r.tokens.cache_creation_5m + r.tokens.cache_creation_1h)
        .sum();
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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn base() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap()
    }

    fn rec(hours: i64, model: &str, input: u64) -> Record {
        Record {
            ts: base() + Duration::hours(hours),
            model: model.to_string(),
            tokens: UsageTokens {
                input,
                output: 0,
                cache_creation_5m: 0,
                cache_creation_1h: 0,
                cache_read: 0,
                ..Default::default()
            },
        }
    }

    #[test]
    fn group_blocks_merges_within_5h() {
        // 3 records within 5h of the first → one block, costs summed.
        let recs = vec![
            rec(0, "claude-opus-4-7", 1_000_000),
            rec(2, "claude-opus-4-7", 1_000_000),
            rec(4, "claude-opus-4-7", 1_000_000),
        ];
        let blocks = group_blocks(&recs);
        assert_eq!(blocks.len(), 1);
        assert!((blocks[0].cost - 15.0).abs() < 1e-9); // 3 × $5/M input
    }

    #[test]
    fn group_blocks_splits_after_5h() {
        let recs = vec![
            rec(0, "claude-opus-4-7", 1_000_000),
            rec(6, "claude-opus-4-7", 1_000_000),
        ];
        assert_eq!(group_blocks(&recs).len(), 2);
    }

    #[test]
    fn group_blocks_exactly_5h_starts_new_block() {
        // (ts - start).num_hours() < 5; exactly 5 is not < 5 → new block.
        let recs = vec![
            rec(0, "claude-opus-4-7", 1_000_000),
            rec(5, "claude-opus-4-7", 1_000_000),
        ];
        assert_eq!(group_blocks(&recs).len(), 2);
    }

    #[test]
    fn active_view_active_within_5h() {
        let blocks = vec![Block { start: base(), cost: 1.0 }];
        let v = active_view(&blocks, base() + Duration::hours(2)).unwrap();
        assert_eq!(v.elapsed_min, 120);
        assert_eq!(v.remaining_min, 180);
        assert_eq!(v.total_min, 300);
    }

    #[test]
    fn active_view_none_when_stale() {
        let blocks = vec![Block { start: base(), cost: 1.0 }];
        assert!(active_view(&blocks, base() + Duration::hours(6)).is_none());
    }

    #[test]
    fn daily_totals_buckets_by_day_and_family() {
        // Two records at the SAME instant (same local day in any TZ) with
        // different families, plus one 72h later (a different local day in any
        // TZ). Assertions are timezone-robust — no exact date strings.
        let recs = vec![
            rec(0, "claude-opus-4-7", 1_000_000), // $5
            rec(0, "claude-fable-5", 1_000_000),  // $10
            rec(72, "claude-opus-4-7", 1_000_000), // $5, different day
        ];
        let days = daily_totals(&recs);
        assert!(days.len() >= 2, "72h apart must split into ≥2 days");
        // oldest-first
        for w in days.windows(2) {
            assert!(w[0].date <= w[1].date);
        }
        // Grand totals are invariant under bucketing.
        let total_cost: f64 = days.iter().map(|d| d.cost).sum();
        let total_tokens: u64 = days.iter().map(|d| d.tokens).sum();
        assert!((total_cost - 20.0).abs() < 1e-9);
        assert_eq!(total_tokens, 3_000_000);
        // Each day's cost == sum of its families.
        for d in &days {
            let famsum: f64 = d.families.iter().map(|f| f.cost).sum();
            assert!((d.cost - famsum).abs() < 1e-9);
        }
        // The same-instant day has both families, sorted by cost desc (Fable $10 > Opus $5).
        let multi = days.iter().find(|d| d.families.len() >= 2).unwrap();
        assert_eq!(multi.families.len(), 2);
        assert_eq!(multi.families[0].family, "Fable");
    }

    #[test]
    fn overall_stats_cache_hit_pct() {
        let mut r = rec(0, "claude-opus-4-7", 100);
        r.tokens.cache_read = 300;
        let recs = vec![r];
        let blocks = group_blocks(&recs);
        let s = overall_stats(&recs, &blocks);
        assert_eq!(s.total_messages, 1);
        // 300 / (100 + 0 + 300) = 75%
        assert!((s.cache_hit_pct - 75.0).abs() < 1e-9);
    }

    #[test]
    fn family_totals_sorted_by_cost_desc() {
        let recs = vec![
            rec(0, "claude-haiku-4-5", 1_000_000), // $1/M
            rec(1, "claude-opus-4-7", 1_000_000),  // $5/M
        ];
        let fams = family_totals(&recs);
        assert_eq!(fams[0].family, "Opus");
        assert_eq!(fams[1].family, "Haiku");
    }

    #[test]
    fn recent_blocks_caps_at_5_newest_first() {
        // 6 blocks 6h apart → keep newest 5, reversed.
        let recs: Vec<Record> = (0..6)
            .map(|i| rec(i * 6, "claude-opus-4-7", 1_000_000))
            .collect();
        let blocks = group_blocks(&recs);
        assert_eq!(blocks.len(), 6);
        let recent = recent_blocks(&blocks);
        assert_eq!(recent.len(), RECENT_BLOCKS);
        assert_eq!(recent[0].start, (base() + Duration::hours(30)).to_rfc3339());
    }
}
