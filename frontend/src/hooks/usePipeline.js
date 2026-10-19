// Data for the Pipeline screen: stored runs and the poller's sync state.
// Loaded over REST, kept live from pipeline.run (a run changed) and
// pipeline.sync (GitHub reachable or not), and reloaded after a reconnect.

import { useCallback, useEffect, useState } from 'react';

import { getPipelineRuns } from '../services/api.service.js';
import { onConsoleEvent } from '../services/realtime.service.js';

const LIMIT = 20;
const byNewest = (a, b) => Date.parse(b.startedAt ?? 0) - Date.parse(a.startedAt ?? 0);

export const usePipeline = (connection) => {
  const [runs, setRuns] = useState([]);
  const [sync, setSync] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await getPipelineRuns(LIMIT);
      setRuns(data.items);
      setSync(data.sync);
      setError(null);
      setLoaded(true);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    if (connection === 'live') load();
  }, [connection, load]);

  useEffect(() => {
    const offs = [
      onConsoleEvent('pipeline.run', (run) =>
        setRuns((list) => [run, ...list.filter((r) => r._id !== run._id)].sort(byNewest).slice(0, LIMIT)),
      ),
      onConsoleEvent('pipeline.sync', setSync),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  return { runs, sync, loaded, error };
};
