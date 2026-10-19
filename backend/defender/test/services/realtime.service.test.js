import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';

import { io as connect } from 'socket.io-client';

import { createRealtime, FORWARDED_EVENTS } from '../../src/services/realtime.service.js';
import { listen } from '../apiFakes.js';

const STATUS = { defender: 'ok', redis: 'ok', mongo: 'ok', consumerLagMs: 10, hooks: [], killSwitch: false, env: 'staging' };

let httpServer;
let realtime;
let port;
const bus = new EventEmitter();
let status = { ...STATUS };

before(async () => {
  httpServer = createServer();
  realtime = createRealtime({ httpServer, bus, getStatus: async () => status, statusPollMs: 60_000 });
  port = await listen(httpServer);
});
after(async () => {
  await realtime.close();
});

const open = (opts = {}) =>
  connect(`http://127.0.0.1:${port}/console`, { transports: ['websocket'], reconnection: false, forceNew: true, ...opts });
const once = (socket, event, ms = 2000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no ${event} within ${ms} ms`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });

test('a console client gets system.status on connect', async () => {
  const s = open();
  try {
    assert.deepEqual(await once(s, 'system.status'), STATUS);
  } finally {
    s.close();
  }
});

test('every bus event is forwarded to /console clients within the PRD F6 budget (< 1 s)', async () => {
  const s = open();
  try {
    await once(s, 'system.status');
    for (const name of FORWARDED_EVENTS) {
      const started = Date.now();
      const got = once(s, name, 1000);
      bus.emit(name, { name, subject: '3e9a5b0c1d2e44c1' });
      assert.deepEqual(await got, { name, subject: '3e9a5b0c1d2e44c1' });
      assert.ok(Date.now() - started < 1000, name);
    }
  } finally {
    s.close();
  }
});

test('system.status is pushed again only when the status meaningfully changes', async () => {
  const s = open();
  try {
    await once(s, 'system.status');
    const baseline = once(s, 'system.status');
    await realtime.pollStatus(); // first poll records the baseline and pushes once
    await baseline; // let that push arrive before counting
    status = { ...STATUS, consumerLagMs: 999 }; // lag alone is not a change
    let pushes = 0;
    s.on('system.status', () => pushes++);
    await realtime.pollStatus();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(pushes, 0, 'lag-only change is not pushed');

    status = { ...STATUS, redis: 'down' };
    const changed = once(s, 'system.status');
    await realtime.pollStatus();
    assert.equal((await changed).redis, 'down');
  } finally {
    status = { ...STATUS };
    s.close();
  }
});

test('a cross-site Origin is refused at the handshake', async () => {
  const s = open({ extraHeaders: { origin: 'https://attacker.example' } });
  try {
    await once(s, 'connect_error');
  } finally {
    s.close();
  }
});

test('the default namespace serves nothing', async () => {
  const s = connect(`http://127.0.0.1:${port}/`, { transports: ['websocket'], reconnection: false, forceNew: true });
  try {
    await once(s, 'disconnect');
  } finally {
    s.close();
  }
});
