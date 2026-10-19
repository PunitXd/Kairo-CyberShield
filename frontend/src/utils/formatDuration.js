// Duration formatting for KPI tiles and countdowns. Plain functions, no React,
// so they can be unit-tested with node --test.

/** TTD/TTR: null → "—", 4 → "4 ms", 820 → "820 ms", 1900 → "1.9 s", 12400 → "12 s". */
export const formatLatency = (ms) => {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 1000)} s`;
};

/** Countdown: 291000 → "4:51", 3600000 → "1:00:00", ≤ 0 → "expired". */
export const formatCountdown = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return 'expired';
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
