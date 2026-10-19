// Data for the Overview screen: incidents (last 24 h), active blocks and the
// KPI numbers. Loaded once over REST, then kept live from the /console pushes:
//   incident.created / incident.updated → upsert by id (updated in place)
//   block.added / block.removed         → the active-keys map
//   any of the above                     → refetch KPIs, at most every 0.5 s
// Everything is reloaded after a reconnect, so events missed while the socket
// was down are not lost.

import { useCallback, useEffect, useRef, useState } from 'react';

import { getBlocks, getIncidents, getOverview } from '../services/api.service.js';
import { onConsoleEvent } from '../services/realtime.service.js';
import { blockKey, upsertIncident } from '../utils/incidentState.js';

const DAY_MS = 24 * 3600_000;
const FRESH_MS = 2000; // new-row highlight (BRIEF §3 motion)
const KPI_REFRESH_MS = 500;

export const useOverviewData = (connection) => {
  const [incidents, setIncidents] = useState([]);
  const [blocks, setBlocks] = useState(() => new Map());
  const [overview, setOverview] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [dataAt, setDataAt] = useState(null);
  const [freshIds, setFreshIds] = useState(() => new Set());
  const kpiTimer = useRef(null);

  const load = useCallback(async () => {
    try {
      const [inc, blk, ov] = await Promise.all([
        getIncidents({ since: Date.now() - DAY_MS, limit: 50 }),
        getBlocks(),
        getOverview(),
      ]);
      setIncidents(inc.items);
      setBlocks(new Map(blk.items.map((b) => [blockKey(b), b])));
      setOverview(ov);
      setError(null);
      setLoaded(true);
      setDataAt(Date.now());
    } catch (err) {
      setError(err);
    }
  }, []);

  // Initial load, and a full resync every time the socket (re)connects.
  useEffect(() => {
    if (connection === 'live') load();
  }, [connection, load]);

  useEffect(() => {
    const refreshKpis = () => {
      if (kpiTimer.current) return;
      kpiTimer.current = setTimeout(async () => {
        kpiTimer.current = null;
        try {
          setOverview(await getOverview());
        } catch {
          /* keep the last numbers; the connection status says why */
        }
      }, KPI_REFRESH_MS);
    };
    const touched = () => setDataAt(Date.now());
    const markFresh = (id) => {
      setFreshIds((s) => new Set(s).add(id));
      setTimeout(
        () =>
          setFreshIds((s) => {
            const next = new Set(s);
            next.delete(id);
            return next;
          }),
        FRESH_MS
      );
    };

    const offs = [
      onConsoleEvent('incident.created', (incident) => {
        setIncidents((list) => upsertIncident(list, incident));
        markFresh(incident._id);
        touched();
        refreshKpis();
      }),
      onConsoleEvent('incident.updated', (incident) => {
        setIncidents((list) => upsertIncident(list, incident));
        touched();
        refreshKpis();
      }),
      onConsoleEvent('block.added', (block) => {
        setBlocks((m) => new Map(m).set(blockKey(block), block));
        touched();
      }),
      onConsoleEvent('block.removed', (block) => {
        setBlocks((m) => {
          const next = new Map(m);
          next.delete(blockKey(block));
          return next;
        });
        touched();
        refreshKpis();
      }),
      onConsoleEvent('action.applied', refreshKpis),
    ];
    return () => {
      offs.forEach((off) => off());
      clearTimeout(kpiTimer.current);
      kpiTimer.current = null;
    };
  }, []);

  return { incidents, blocks: [...blocks.values()], overview, loaded, error, dataAt, freshIds };
};
