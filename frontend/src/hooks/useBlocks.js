// Data for the Blocklist screen: every active block and throttle, the recent
// incidents they belong to (for the "reason" column) and the active-block cap.
// Loaded over REST, kept live from block.added / block.removed and the
// incident pushes, and reloaded after a reconnect.

import { useCallback, useEffect, useRef, useState } from 'react';

import { getBlocks, getIncidents, getOverview } from '../services/api.service.js';
import { onConsoleEvent } from '../services/realtime.service.js';
import { blockKey } from '../utils/incidentState.js';

const DAY_MS = 24 * 3600_000;

export const useBlocks = (connection, redis) => {
  const [blocks, setBlocks] = useState(() => new Map());
  const [incidents, setIncidents] = useState(() => new Map());
  const [cap, setCap] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [lastExpiryAt, setLastExpiryAt] = useState(null);

  const load = useCallback(async () => {
    try {
      const [blk, inc, ov] = await Promise.all([getBlocks(), getIncidents({ since: Date.now() - DAY_MS, limit: 200 }), getOverview()]);
      setBlocks(new Map(blk.items.map((b) => [blockKey(b), b])));
      setIncidents(new Map(inc.items.map((i) => [i._id, i])));
      setCap(ov.activeBlockCap ?? null);
      setError(null);
      setLoaded(true);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    if (connection === 'live') load();
  }, [connection, load]);

  // Redis back after an outage: reload, since blocks may have expired or come back from AOF.
  const lastRedis = useRef(redis);
  useEffect(() => {
    if (lastRedis.current === 'down' && redis === 'ok' && connection === 'live') load();
    lastRedis.current = redis;
  }, [redis, connection, load]);

  useEffect(() => {
    const upsertIncident = (incident) => setIncidents((m) => new Map(m).set(incident._id, incident));
    const offs = [
      onConsoleEvent('block.added', (b) => setBlocks((m) => new Map(m).set(blockKey(b), b))),
      onConsoleEvent('block.removed', (b) => {
        setBlocks((m) => {
          const next = new Map(m);
          next.delete(blockKey(b));
          return next;
        });
        if (b.reason === 'expired') setLastExpiryAt(Date.now());
      }),
      onConsoleEvent('incident.created', upsertIncident),
      onConsoleEvent('incident.updated', upsertIncident),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  const removeBlocksFor = useCallback((scope, subject) => {
    setBlocks((m) => {
      const next = new Map(m);
      for (const [key, b] of next) if (b.scope === scope && b.subject === subject) next.delete(key);
      return next;
    });
  }, []);

  return { blocks: [...blocks.values()], incidents, cap, loaded, error, lastExpiryAt, removeBlocksFor };
};
