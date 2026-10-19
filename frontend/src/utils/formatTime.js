/** 1792407818301 → "14:02:11" (local time, 24 h). */
export const formatClock = (ms) =>
  ms ? new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—';

/** 4300 → "4 s", 125000 → "2 min". */
export const formatElapsed = (ms) => (ms < 120_000 ? `${Math.floor(ms / 1000)} s` : `${Math.floor(ms / 60_000)} min`);
