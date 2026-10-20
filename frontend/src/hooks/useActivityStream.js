// The Overview's activity stream (PHASES Oct 21 #2): the latest 30 raw events
// from /api/events/sample (the Privacy screen's endpoint), polled every second.
// While `paused` the rows on screen stay put and polling continues, so the
// stream can say how many newer events are waiting ("12 new").

import { useEffect, useRef, useState } from 'react';

import { getEventSample } from '../services/api.service.js';
import { countNew, describeEvent } from '../utils/liveRates.js';

const POLL_MS = 1000;

// Identical events in the same millisecond get #2, #3… so every row key is unique.
const withUniqueKeys = (rows) => {
  const seen = new Map();
  return rows.map((r) => {
    const n = (seen.get(r.key) ?? 0) + 1;
    seen.set(r.key, n);
    return n === 1 ? r : { ...r, key: `${r.key}#${n}` };
  });
};
const LIMIT = 30;

export const useActivityStream = ({ paused }) => {
  const [rows, setRows] = useState([]);
  const [newCount, setNewCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const latest = useRef([]);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const { items } = await getEventSample(LIMIT);
        if (cancelled) return;
        latest.current = withUniqueKeys(items.map(describeEvent));
        setError(null);
        if (pausedRef.current) setRows((shown) => (setNewCount(countNew(shown, latest.current)), shown));
        else setRows(latest.current);
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (paused) return;
    setRows(latest.current);
    setNewCount(0);
  }, [paused]);

  return { rows, newCount, loaded, error };
};
