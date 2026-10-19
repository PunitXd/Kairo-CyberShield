// One-second clock for countdowns. While the data is stale (Defender
// unreachable) the clock stops, so every countdown freezes at its last known
// value instead of pretending to know (BRIEF §8).

import { useEffect, useState } from 'react';

export const useNow = (frozen = false) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (frozen) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [frozen]);
  return now;
};
