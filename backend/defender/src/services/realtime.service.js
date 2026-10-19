// Realtime channel (ARCH §9.3): Socket.io namespace /console, server → client
// only. Mutations always go through REST. Pushes:
//   system.status                       on connect and whenever it changes
//   incident.created / incident.updated from the remediation service
//   action.applied                      from the remediation service
//   block.added / block.removed         remediation (added), block watcher (expired)
//   pipeline.run / pipeline.sync        GitHub poller (a run changed / GitHub reachable or not)
// The handshake gets the same localhost + same-origin check as the REST API.

import { Server } from 'socket.io';

import { checkLocalRequest } from '../middlewares/localOnly.middleware.js';
import { statusFingerprint } from './health.service.js';

export const CONSOLE_NAMESPACE = '/console';
export const FORWARDED_EVENTS = [
  'incident.created',
  'incident.updated',
  'action.applied',
  'block.added',
  'block.removed',
  'pipeline.run',
  'pipeline.sync',
];
const STATUS_POLL_MS = 2000;

export const createRealtime = ({ httpServer, bus, getStatus, log, statusPollMs = STATUS_POLL_MS }) => {
  const io = new Server(httpServer, {
    serveClient: false,
    allowRequest: (req, callback) => callback(null, checkLocalRequest(req.headers) === null),
  });

  // Nothing is served on the default namespace.
  io.of('/').on('connection', (socket) => socket.disconnect(true));

  const consoleNs = io.of(CONSOLE_NAMESPACE);
  consoleNs.on('connection', async (socket) => {
    try {
      socket.emit('system.status', await getStatus());
    } catch (err) {
      log?.warn({ msg: 'realtime.status_failed', error: err?.message?.slice(0, 200) });
    }
  });

  const forwarders = FORWARDED_EVENTS.map((name) => {
    const fn = (payload) => consoleNs.emit(name, payload);
    bus.on(name, fn);
    return [name, fn];
  });

  let lastFingerprint = null;
  const pollStatus = async () => {
    try {
      const status = await getStatus();
      const fp = statusFingerprint(status);
      if (fp !== lastFingerprint) {
        lastFingerprint = fp;
        consoleNs.emit('system.status', status);
      }
    } catch (err) {
      log?.warn({ msg: 'realtime.status_failed', error: err?.message?.slice(0, 200) });
    }
  };
  const timer = setInterval(pollStatus, statusPollMs);
  timer.unref?.();
  // An operator change (kill switch) is pushed at once, not on the next poll.
  bus.on('system.changed', pollStatus);

  return {
    io,
    pollStatus,
    async close() {
      clearInterval(timer);
      for (const [name, fn] of forwarders) bus.off(name, fn);
      bus.off('system.changed', pollStatus);
      await io.close();
    },
  };
};
