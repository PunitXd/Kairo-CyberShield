// The Privacy screen's live sample: the newest raw events, polled every 2 s
// (PHASES Oct 21 #3), paused while the operator is reading it (hover/focus).

import { useEffect, useState } from 'react';

import { getEventSample } from '../services/api.service.js';

const POLL_MS = 2000;

export const useEventSample = ({ paused, limit = 20 }) => {
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    if (paused) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const { items: next } = await getEventSample(limit);
        if (cancelled) return;
        setItems(next);
        setError(null);
        setUpdatedAt(Date.now());
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
  }, [paused, limit]);

  return { items, loaded, error, updatedAt };
};
