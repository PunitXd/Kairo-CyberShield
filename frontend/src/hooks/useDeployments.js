// Deployments screen data (PHASES Oct 22 #4): GET /api/deployments on every
// (re)connect, then again (at most every 0.5 s) on deployment.updated and when
// system.status says the rollback state changed.

import { useCallback, useEffect, useRef, useState } from 'react';

import { getDeployments } from '../services/api.service.js';
import { onConsoleEvent } from '../services/realtime.service.js';

const REFRESH_MS = 500;

export const useDeployments = (connection, rollbackKey) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      setData(await getDeployments());
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    if (connection === 'live') load();
  }, [connection, load, rollbackKey]);

  useEffect(() => {
    const soon = () => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        load();
      }, REFRESH_MS);
    };
    const off = onConsoleEvent('deployment.updated', soon);
    return () => {
      off();
      clearTimeout(timer.current);
      timer.current = null;
    };
  }, [load]);

  return { data, error, loaded: Boolean(data), reload: load };
};
