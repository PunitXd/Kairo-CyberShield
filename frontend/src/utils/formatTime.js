/** 1792407818301 → "14:02:11" (local time, 24 h). */
export const formatClock = (ms) =>
  ms ? new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—';

/** 4300 → "4 s", 125000 → "2 min". */
export const formatElapsed = (ms) => (ms < 120_000 ? `${Math.floor(ms / 1000)} s` : `${Math.floor(ms / 60_000)} min`);

/** Relative time for run cards: "just now", "4 min ago", "3 h ago", "2 d ago". */
export const formatAgo = (ms, now = Date.now()) => {
  if (!ms) return '—';
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
};

/** Run and job durations: 7000 → "7 s", 95000 → "1 min 35 s". */
export const formatRunDuration = (ms) => {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
};
