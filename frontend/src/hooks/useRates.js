// The live chart's samples (PHASES Oct 21 #2): the last 5 minutes from
// GET /api/rates on every (re)connect, then one `rates.tick` per second.
// While `paused` (the operator is reading the activity stream) ticks are still
// collected, but the returned samples stay frozen so nothing moves under the
// pointer; unpausing jumps to the latest.

import { useEffect, useRef, useState } from 'react';

import { getRates } from '../services/api.service.js';
import { onConsoleEvent } from '../services/realtime.service.js';
import { HISTORY_MS } from '../utils/liveRates.js';

const trim = (list) => {
  const newest = list.at(-1)?.t ?? 0;
  return list.filter((s) => s.t > newest - HISTORY_MS);
};

export const useRates = (connection, { paused = false } = {}) => {
  const live = useRef([]);
  const [samples, setSamples] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const publish = () => {
    if (!pausedRef.current) setSamples(live.current);
  };

  useEffect(() => {
    if (connection !== 'live') return undefined;
    let cancelled = false;
    getRates(HISTORY_MS / 1000)
      .then(({ samples: history }) => {
        if (cancelled) return;
        // Ticks that arrived while the request was in flight are newer: keep them.
        const after = live.current.filter((s) => s.t > (history.at(-1)?.t ?? 0));
        live.current = trim([...history, ...after]);
        setLoaded(true);
        publish();
      })
      .catch(() => {
        /* the ticks still fill the chart; the connection status says why */
      });
    return () => {
      cancelled = true;
    };
  }, [connection]);

  useEffect(
    () =>
      onConsoleEvent('rates.tick', (sample) => {
        const last = live.current.at(-1);
        if (last && sample.t <= last.t) return; // duplicate after a reconnect
        live.current = trim([...live.current, sample]);
        setLoaded(true);
        publish();
      }),
    []
  );

  useEffect(() => {
    if (!paused) setSamples(live.current);
  }, [paused]);

  return { samples, loaded };
};
