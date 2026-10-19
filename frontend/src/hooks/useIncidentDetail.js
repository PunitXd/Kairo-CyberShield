// One incident's detail for the drawer: { incident, actions, timeline } from
// GET /api/incidents/:id, refetched (at most every 300 ms) whenever the
// incident, one of its actions or one of its blocks changes over /console.

import { useCallback, useEffect, useRef, useState } from 'react';

import { getIncident } from '../services/api.service.js';
import { onConsoleEvent } from '../services/realtime.service.js';

const REFRESH_MS = 300;

export const useIncidentDetail = (id) => {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      setDetail(await getIncident(id));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setDetail(null);
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    const refresh = () => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        load();
      }, REFRESH_MS);
    };
    const mine = (payload) => payload?._id === id || payload?.incidentId === id;
    const offs = ['incident.updated', 'action.applied', 'block.added', 'block.removed'].map((name) =>
      onConsoleEvent(name, (payload) => mine(payload) && refresh())
    );
    return () => {
      offs.forEach((off) => off());
      clearTimeout(timer.current);
      timer.current = null;
    };
  }, [id, load]);

  return { detail, error, loading, reload: load };
};
