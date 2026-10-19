// The /console Socket.io client (ARCH §9.3), one per page, shared by every
// component through useConsole(). Same origin only: in dev the Vite proxy
// forwards /socket.io to the Defender; in production the Defender serves this
// page itself.
//
// It keeps a small snapshot (connection state + latest system.status) for
// useSyncExternalStore, and lets screens subscribe to the other pushes
// (incident.*, action.applied, block.*) with onConsoleEvent().

import { io } from 'socket.io-client';

let socket = null;
const listeners = new Set();
let snapshot = { connection: 'connecting', connectionSince: Date.now(), status: null, statusAt: null };

const update = (patch) => {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
};

const markDisconnected = () => {
  if (snapshot.connection !== 'reconnecting') update({ connection: 'reconnecting', connectionSince: Date.now() });
};

export const connectConsole = () => {
  if (socket) return socket;
  socket = io('/console', { transports: ['websocket'], reconnectionDelayMax: 5000 });
  socket.on('connect', () => update({ connection: 'live', connectionSince: Date.now() }));
  socket.on('disconnect', markDisconnected);
  socket.on('connect_error', markDisconnected);
  socket.on('system.status', (status) => update({ status, statusAt: Date.now() }));
  return socket;
};

export const subscribeConsole = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getConsoleSnapshot = () => snapshot;

/** Subscribe to one realtime event; returns the unsubscribe function. */
export const onConsoleEvent = (name, handler) => {
  const s = connectConsole();
  s.on(name, handler);
  return () => s.off(name, handler);
};
