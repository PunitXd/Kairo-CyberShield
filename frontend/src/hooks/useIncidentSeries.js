// The drawer chart's data (PHASES Oct 22 #5): GET /api/incidents/:id/series,
// refreshed every 2 s while the incident is recent (its source may still be
// attacking), then left alone.

import { useEffect, useState } from 'react';

import { getIncidentSeries } from '../services/api.service.js';

const POLL_MS = 2000;
const LIVE_FOR_MS = 3 * 60_000; // keep refreshing until 3 min after the last activity

export const useIncidentSeries = (id, lastSeenAt) => {
  const [series, setSeries] = useState(null);
  const [error, setError] = useState(null);
  const lastSeen = lastSeenAt ? Date.parse(lastSeenAt) : 0;

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    let timer = null;
    const load = async () => {
      try {
        const s = await getIncidentSeries(id);
        if (!cancelled) {
          setSeries(s);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      }
      if (!cancelled && Date.now() - lastSeen < LIVE_FOR_MS) timer = setTimeout(load, POLL_MS);
    };
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, lastSeen]);

  return { series, error };
};
