// The Incidents screen's data (PHASES Oct 21 #5): one page of 50 from
// GET /api/incidents for the current filters, with a cursor stack for
// Newer / Older. Page 1 refetches (at most every 0.5 s) when incidents are
// created or updated, so new ones appear at the top; older pages stay put.

import { useCallback, useEffect, useRef, useState } from 'react';

import { getIncidents } from '../services/api.service.js';
import { onConsoleEvent } from '../services/realtime.service.js';
import { toApiParams } from '../utils/incidentFilters.js';

export const PAGE_SIZE = 50;
const REFRESH_MS = 500;

export const useIncidents = (filters, connection) => {
  const key = JSON.stringify(filters);
  const [cursors, setCursors] = useState([null]); // cursor for each page; [0] = newest
  const [page, setPage] = useState({ items: [], nextCursor: null });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const timer = useRef(null);
  const cursor = cursors.at(-1);

  // New filters → back to the newest page.
  useEffect(() => setCursors([null]), [key]);

  const load = useCallback(async () => {
    try {
      const res = await getIncidents({ ...toApiParams(JSON.parse(key), Date.now()), limit: PAGE_SIZE, cursor: cursor ?? undefined });
      setPage(res);
      setError(null);
      setLoaded(true);
    } catch (err) {
      setError(err);
    }
  }, [key, cursor]);

  useEffect(() => {
    if (connection === 'live') load();
  }, [connection, load]);

  useEffect(() => {
    if (cursor) return undefined; // only the newest page follows live updates
    const soon = () => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        load();
      }, REFRESH_MS);
    };
    const offs = ['incident.created', 'incident.updated'].map((name) => onConsoleEvent(name, soon));
    return () => {
      offs.forEach((off) => off());
      clearTimeout(timer.current);
      timer.current = null;
    };
  }, [cursor, load]);

  return {
    items: page.items,
    loaded,
    error,
    pageIndex: cursors.length - 1,
    hasOlder: Boolean(page.nextCursor),
    older: () => page.nextCursor && setCursors((c) => [...c, page.nextCursor]),
    newer: () => setCursors((c) => (c.length > 1 ? c.slice(0, -1) : c)),
  };
};
