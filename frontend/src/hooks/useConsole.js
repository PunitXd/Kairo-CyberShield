// Connection state and the latest system.status from the /console socket.
//
// connection: 'connecting' | 'live' | 'reconnecting' | 'down'
// 'down' is 'reconnecting' for 10 s or more (BRIEF §8: brief blips on venue
// Wi-Fi are normal and get no banner). While not live, `now` ticks once per
// second so "reconnecting 4 s" and "down since" stay current.

import { useEffect, useState, useSyncExternalStore } from 'react';

import { connectConsole, getConsoleSnapshot, subscribeConsole } from '../services/realtime.service.js';

export const DOWN_AFTER_MS = 10_000;

export const useConsole = () => {
  useEffect(() => {
    connectConsole();
  }, []);
  const snapshot = useSyncExternalStore(subscribeConsole, getConsoleSnapshot);

  const [now, setNow] = useState(() => Date.now());
  const ticking = snapshot.connection !== 'live';
  useEffect(() => {
    if (!ticking) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  const elapsedMs = Math.max(0, now - snapshot.connectionSince);
  const connection =
    snapshot.connection === 'reconnecting' && elapsedMs >= DOWN_AFTER_MS ? 'down' : snapshot.connection;

  return { ...snapshot, connection, elapsedMs };
};
