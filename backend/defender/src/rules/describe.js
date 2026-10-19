/** 60000 → "60 s", 300000 → "5 min", 3600000 → "60 min" (for incident summaries). */
export const describeWindow = (ms) => (ms < 120_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);
