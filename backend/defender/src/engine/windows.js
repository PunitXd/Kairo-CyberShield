// Sliding windows in Defender memory (ARCH §6.3, D5).
//
// Per (rule, subject): buckets of max(1 s, windowMs / 60), each with a sum and
// an optional set of distinct values (e.g. account hashes). Precision is ± one
// bucket, which is plenty for thresholds this coarse. Time comes from event
// timestamps, so rules are deterministic and unit-testable with fake events.
// A single Defender is the only consumer; what must survive restarts (blocks,
// strikes, open incidents) is in Redis, and windows refill from new events.

const FIRING_MEMORY_MS = 60 * 60_000;

export const bucketMsFor = (windowMs) => Math.max(1000, Math.floor(windowMs / 60));

export class WindowStore {
  constructor() {
    this.series = new Map(); // `${ruleId}|${subject}` -> { bucketMs, windowMs, buckets: Map<idx, {sum, distinct}>, lastTs }
    this.fired = new Map(); // `${ruleId}|${subject}` -> number[] (firing timestamps)
  }

  add(ruleId, subject, { value = 1, distinct = null } = {}, ts, windowMs) {
    const key = `${ruleId}|${subject}`;
    let s = this.series.get(key);
    if (!s) {
      s = { bucketMs: bucketMsFor(windowMs), windowMs, buckets: new Map(), lastTs: ts };
      this.series.set(key, s);
    }
    const idx = Math.floor(ts / s.bucketMs);
    let b = s.buckets.get(idx);
    if (!b) {
      b = { sum: 0, distinct: new Set() };
      s.buckets.set(idx, b);
    }
    b.sum += value;
    if (distinct != null) b.distinct.add(distinct);
    s.lastTs = Math.max(s.lastTs, ts);
    for (const old of s.buckets.keys()) {
      if ((old + 1) * s.bucketMs <= s.lastTs - s.windowMs) s.buckets.delete(old);
    }
  }

  #inWindow(ruleId, subject, windowMs, now) {
    const s = this.series.get(`${ruleId}|${subject}`);
    if (!s) return [];
    const from = now - windowMs;
    return [...s.buckets].filter(([idx]) => (idx + 1) * s.bucketMs > from && idx * s.bucketMs <= now).map(([, b]) => b);
  }

  sum(ruleId, subject, windowMs, now) {
    return this.#inWindow(ruleId, subject, windowMs, now).reduce((n, b) => n + b.sum, 0);
  }

  distinct(ruleId, subject, windowMs, now) {
    const all = new Set();
    for (const b of this.#inWindow(ruleId, subject, windowMs, now)) for (const v of b.distinct) all.add(v);
    return all.size;
  }

  /** Forget a rule's counts for one subject (called after the rule fires). */
  reset(ruleId, subject) {
    this.series.delete(`${ruleId}|${subject}`);
  }

  recordFiring(ruleId, subject, ts) {
    const key = `${ruleId}|${subject}`;
    const list = this.fired.get(key) ?? [];
    list.push(ts);
    this.fired.set(key, list.filter((t) => t > ts - FIRING_MEMORY_MS));
  }

  /** Firings in the last `ms`, optionally only those strictly after `after`. */
  firings(ruleId, subject, ms, now, after = -Infinity) {
    const from = Math.max(now - ms, after);
    return (this.fired.get(`${ruleId}|${subject}`) ?? []).filter((t) => t > from && t <= now).length;
  }

  lastFiring(ruleId, subject) {
    const list = this.fired.get(`${ruleId}|${subject}`);
    return list?.length ? list.at(-1) : -Infinity;
  }

  /** The per-subject view rules evaluate against. */
  view(subject, now) {
    return {
      sum: (ruleId, windowMs) => this.sum(ruleId, subject, windowMs, now),
      distinct: (ruleId, windowMs) => this.distinct(ruleId, subject, windowMs, now),
      firings: (ruleId, ms, after) => this.firings(ruleId, subject, ms, now, after),
      lastFiring: (ruleId) => this.lastFiring(ruleId, subject),
    };
  }

  /** Drop subjects idle for longer than their window (run every 30 s). */
  sweep(now) {
    for (const [key, s] of this.series) if (s.lastTs < now - s.windowMs) this.series.delete(key);
    for (const [key, list] of this.fired) {
      const kept = list.filter((t) => t > now - FIRING_MEMORY_MS);
      if (kept.length) this.fired.set(key, kept);
      else this.fired.delete(key);
    }
  }

  get size() {
    return this.series.size;
  }
}
