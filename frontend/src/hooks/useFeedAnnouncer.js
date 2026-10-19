// Screen-reader summary of feed activity (BRIEF §10). The feed itself is not
// a live region: an attack can produce many updates a second. Instead one
// polite status line announces a summary at most every 10 s, and only when
// something new happened: "2 new incidents in the last 10 seconds. Highest:
// High, R1b. 1 source blocked."

import { useEffect, useRef, useState } from 'react';

const INTERVAL_MS = 10_000;
const RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const WORD = { info: 'Info', low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };

export const useFeedAnnouncer = (incidents, blockedCount) => {
  const [message, setMessage] = useState('');
  const seen = useRef(null);
  const latest = useRef({ incidents, blockedCount });
  latest.current = { incidents, blockedCount };

  useEffect(() => {
    const timer = setInterval(() => {
      const { incidents: list, blockedCount: blocked } = latest.current;
      if (seen.current === null) {
        seen.current = new Set(list.map((i) => i._id)); // don't announce what was already there
        return;
      }
      const fresh = list.filter((i) => !seen.current.has(i._id));
      fresh.forEach((i) => seen.current.add(i._id));
      if (!fresh.length) return;
      const top = fresh.reduce((a, b) => ((RANK[b.severity] ?? 0) > (RANK[a.severity] ?? 0) ? b : a));
      setMessage(
        `${fresh.length} new incident${fresh.length === 1 ? '' : 's'} in the last 10 seconds. ` +
          `Highest: ${WORD[top.severity] ?? top.severity}, ${top.ruleId}. ` +
          `${blocked} source${blocked === 1 ? '' : 's'} blocked.`
      );
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return message;
};
