// Live allowlist entries (PHASES Oct 21 #4): loaded on (re)connect and again
// on every allowlist.changed push. Shared by the Blocklist panel and the
// incident drawer ("Allowlisted until 14:02").

import { useCallback, useEffect, useState } from 'react';

import { getAllowlist } from '../services/api.service.js';
import { onConsoleEvent } from '../services/realtime.service.js';

export const useAllowlist = (connection) => {
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setItems((await getAllowlist()).items);
      setError(null);
      setLoaded(true);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    if (connection === 'live') load();
  }, [connection, load]);
  useEffect(() => onConsoleEvent('allowlist.changed', load), [load]);

  return { items, loaded, error, reload: load };
};
