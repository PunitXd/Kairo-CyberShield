// The Rules & safety screen's data (PHASES Oct 21 #3): GET /api/rules on every
// (re)connect, again on config.updated (a mode changed, here or elsewhere),
// and when incidents arrive (the 7-day counts) or the kill switch changes.

import { useCallback, useEffect, useRef, useState } from 'react';

import { getRules } from '../services/api.service.js';
import { onConsoleEvent } from '../services/realtime.service.js';

const REFRESH_MS = 500;

export const useRules = (connection, killSwitch) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      setData(await getRules());
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    if (connection === 'live') load();
  }, [connection, load]);

  useEffect(() => {
    if (data) load();
  }, [killSwitch]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const soon = () => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        load();
      }, REFRESH_MS);
    };
    const offs = ['config.updated', 'incident.created', 'block.added', 'block.removed'].map((name) => onConsoleEvent(name, soon));
    return () => {
      offs.forEach((off) => off());
      clearTimeout(timer.current);
      timer.current = null;
    };
  }, [load]);

  return { data, error, loaded: Boolean(data), reload: load };
};
