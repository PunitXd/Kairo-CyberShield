// The socket layer against a real Socket.io server and client, with a
// CypherFy-like auth middleware and handlers, and an in-memory Redis.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';

import { Server } from 'socket.io';
import { io as connectClient } from 'socket.io-client';

import { attachSocketLayer, createSocketLayer, safeEventName } from '../src/socket.middleware.js';
import { createJoinGuard } from '../src/joinGuard.service.js';
import { createCommandService } from '../src/command.service.js';
import { createEmitter } from '../src/emitter.service.js';
import { KEYS } from '../src/schema/index.js';
import { fakeRedis, hasher, writtenEvents } from './helpers.js';

const IP = hasher.ip('127.0.0.1');
const ACTION_ID = '01JAB3K5Q8ZP4M2N7R9T1V6W0X';

const waitFor = async (check, ms = 1500) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail('timed out waiting');
};

const setup = async ({ redisMode = 'ok', env = 'staging', emitter: customEmitter, delayMs = 0 } = {}) => {
  const redis = fakeRedis({ mode: redisMode });
  const sink = fakeRedis(); // events always land here, even when the guard's Redis is down
  const logs = [];
  const log = (msg, fields) => logs.push({ msg, ...fields });
  const emitter = customEmitter ?? createEmitter({ redis: sink, timeoutMs: 50, log });
  const ctx = { redis, emitter, hasher, env, inst: 'test-1', timeoutMs: 50, log };

  const httpServer = createServer();
  const io = new Server(httpServer);
  // CypherFy's own optional JWT auth runs first and sets socket.data.userId.
  io.use((socket, next) => {
    socket.data.userId = socket.handshake.auth?.userId ?? null;
    next();
  });
  const layer = createSocketLayer({ io, ...ctx, autoFlush: false });
  attachSocketLayer(io, () => layer);
  const denyJoin = createJoinGuard({ layer, ...ctx });

  const handled = [];
  io.on('connection', (socket) => {
    socket.emitError = (code, message) => socket.emit('error', { code, message });
    socket.on('join_room', async (payload) => {
      handled.push('join_room');
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs)); // like CypherFy's Room.findOne
      const code = String(payload?.code ?? '').toUpperCase();
      if (!code) return socket.emitError('INVALID_CODE', 'code and alias required');
      if (await denyJoin(socket, code)) return;
      handled.push('lookup');
      if (code === 'GOODRM') socket.emit('room_joined', { ok: true });
      else socket.emitError('ROOM_NOT_FOUND', 'Room not found or expired');
    });
    socket.on('send_message', async (payload) => {
      handled.push('send_message');
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (!payload?.ciphertext) socket.emitError('BAD_PAYLOAD', 'Invalid message');
    });
    socket.onAny((name) => name !== 'join_room' && name !== 'send_message' && handled.push(name));
  });

  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${httpServer.address().port}`;
  const clients = [];
  const connect = (auth = {}) =>
    new Promise((resolve) => {
      const client = connectClient(url, { auth, transports: ['websocket'], reconnection: false, forceNew: true });
      clients.push(client);
      client.errors = [];
      client.on('error', (e) => client.errors.push(e));
      client.once('connect', () => resolve(client));
      client.once('connect_error', (error) => resolve({ refused: error, client }));
    });
  const events = () => writtenEvents(sink);
  const ofType = (type) => events().filter((e) => e.type === type);
  const close = async () => {
    clients.forEach((c) => c.close());
    layer.stop();
    await new Promise((r) => io.close(r));
  };
  return { redis, sink, layer, logs, connect, events, ofType, handled, close, ctx };
};

test('socket.connect and socket.disconnect carry the socket id and hashed source', async (t) => {
  const s = await setup();
  t.after(s.close);
  const client = await s.connect();
  await waitFor(() => s.ofType('socket.connect').length === 1);
  const [connected] = s.ofType('socket.connect');
  assert.deepEqual(connected.src, { ipHash: IP, client: 'unknown', authed: false, socketId: client.id });
  client.close();
  await waitFor(() => s.ofType('socket.disconnect').length === 1);
});

test('packets are counted per event name into one socket.rate per flush, never their payloads', async (t) => {
  const s = await setup();
  t.after(s.close);
  const client = await s.connect();
  for (let i = 0; i < 5; i++) client.emit('send_message', { ciphertext: 'my secret message', iv: 'abc' });
  client.emit('typing_start', { room: 'XK9PLM' });
  client.emit('typing_start', { room: 'XK9PLM' });
  client.emit('hello world {"text":"hi"}', 'smuggled');
  await waitFor(() => s.handled.length === 8);
  s.layer.flush();
  await waitFor(() => s.ofType('socket.rate').length === 1);
  const [rate] = s.ofType('socket.rate');
  assert.deepEqual(rate.sock, { counts: { send_message: 5, typing_start: 2, other: 1 }, total: 8, windowMs: 1000 });
  assert.equal(rate.src.socketId, client.id);
  const all = JSON.stringify(s.events());
  for (const leak of ['my secret message', 'XK9PLM', 'smuggled', 'hello world']) assert.ok(!all.includes(leak), leak);
  s.layer.flush();
  assert.equal(s.ofType('socket.rate').length, 1, 'nothing sent → no empty socket.rate');
});

test('at most 20 event names per bucket; the rest fold into "other"', async (t) => {
  const s = await setup();
  t.after(s.close);
  const client = await s.connect();
  for (let i = 0; i < 25; i++) client.emit(`ev${i}`);
  await waitFor(() => s.handled.length === 25);
  s.layer.flush();
  await waitFor(() => s.ofType('socket.rate').length === 1);
  const { counts, total } = s.ofType('socket.rate')[0].sock;
  assert.equal(total, 25);
  assert.ok(Object.keys(counts).length <= 20);
  assert.equal(counts.other, 6);
  assert.equal(safeEventName(42), 'other');
});

test("CypherFy's own error replies become room.join.invalid, room.join.success and socket.invalid_payload", async (t) => {
  const s = await setup();
  t.after(s.close);
  const client = await s.connect();
  client.emit('join_room', { code: 'badcod', alias: 'eve' });
  await waitFor(() => client.errors.length === 1);
  assert.equal(client.errors[0].code, 'ROOM_NOT_FOUND', 'the client still gets CypherFy reply');
  client.emit('join_room', { code: 'goodrm', alias: 'eve' });
  client.emit('send_message', { nope: true });
  await waitFor(() => s.ofType('room.join.success').length === 1 && s.ofType('socket.invalid_payload').length === 1);

  const [invalid] = s.ofType('room.join.invalid');
  assert.deepEqual(invalid.room, { codeHash: hasher.roomCode('BADCOD'), kind: 'ephemeral', via: 'socket', error: 'ROOM_NOT_FOUND' });
  assert.equal(invalid.src.socketId, client.id);
  assert.equal(s.ofType('room.join.success')[0].room.codeHash, hasher.roomCode('GOODRM'));
  assert.deepEqual(s.ofType('socket.invalid_payload')[0].sock, { event: 'send_message' });
  assert.ok(!JSON.stringify(s.events()).includes('BADCOD'), 'raw code never leaves');
});

test('replies are matched to the packet that caused them, even when newer packets arrive while the handler awaits', async (t) => {
  const s = await setup({ delayMs: 40 });
  t.after(s.close);
  const client = await s.connect();
  client.emit('join_room', { code: 'badcod', alias: 'eve' });
  client.emit('send_message', { nope: true });
  for (let i = 0; i < 5; i++) client.emit('typing_start', {});
  client.emit('join_room', { code: 'goodrm', alias: 'eve' });
  for (let i = 0; i < 5; i++) client.emit('typing_stop', {});
  await waitFor(() => s.ofType('room.join.invalid').length === 1 && s.ofType('socket.invalid_payload').length === 1 && s.ofType('room.join.success').length === 1);
  assert.equal(s.ofType('room.join.invalid')[0].room.codeHash, hasher.roomCode('BADCOD'));
  assert.deepEqual(s.ofType('socket.invalid_payload')[0].sock, { event: 'send_message' });
  assert.equal(s.ofType('room.join.success')[0].room.codeHash, hasher.roomCode('GOODRM'));
});

test('a socket-scope block refuses the handshake with KAIRO_BLOCKED and records http.denied', async (t) => {
  const s = await setup();
  t.after(s.close);
  s.redis.store.set(KEYS.block('socket', IP), JSON.stringify({ rule: 'R3b', expiresAt: Date.now() + 300_000 }));
  const { refused } = await s.connect();
  assert.equal(refused?.message, 'KAIRO_BLOCKED');
  assert.ok(refused.data.retryAfter > 200);
  await waitFor(() => s.ofType('http.denied').length === 1);
  assert.deepEqual(s.ofType('http.denied')[0].http, { scope: 'socket', rule: 'R3b' });
  assert.equal(s.ofType('socket.connect').length, 0);
});

test('logged-in sockets, allowlisted sources and the kill switch pass a socket block', async (t) => {
  const s = await setup();
  t.after(s.close);
  s.redis.store.set(KEYS.block('socket', IP), JSON.stringify({ rule: 'R3b' }));
  const user = await s.connect({ userId: '64f0c0ffee0000000000abcd' });
  assert.ok(user.connected, 'authenticated sockets skip IP-scoped socket blocks');
  s.redis.store.set(KEYS.allow(IP), '1');
  assert.ok((await s.connect()).connected, 'allowlisted');
  s.redis.store.delete(KEYS.allow(IP));
  s.redis.store.set(KEYS.killswitch, '{}');
  assert.ok((await s.connect()).connected, 'kill switch on');
});

test('fails open: Redis down or hanging lets the handshake through quickly', async (t) => {
  for (const mode of ['down', 'hang']) {
    const s = await setup({ redisMode: mode });
    t.after(s.close);
    const started = Date.now();
    const client = await s.connect();
    assert.ok(client.connected, mode);
    assert.ok(Date.now() - started < 1000, `${mode}: no long wait`);
    assert.ok(s.logs.some((l) => l.msg === 'kairo.redis_unavailable'), `${mode}: logged`);
  }
});

test('production is shadow-only: a block key never refuses', async (t) => {
  const s = await setup({ env: 'production' });
  t.after(s.close);
  s.redis.store.set(KEYS.block('socket', IP), JSON.stringify({ rule: 'R3b' }));
  assert.ok((await s.connect()).connected);
});

test('denyJoin refuses a room_join-blocked source with ROOM_NOT_FOUND before the lookup, counted once as denied', async (t) => {
  const s = await setup();
  t.after(s.close);
  const client = await s.connect();
  s.redis.store.set(KEYS.block('room_join', IP), JSON.stringify({ rule: 'R2a' }));
  client.emit('join_room', { code: 'xk9plm', alias: 'eve' });
  await waitFor(() => client.errors.length === 1);
  assert.equal(client.errors[0].code, 'ROOM_NOT_FOUND');
  assert.ok(!s.handled.includes('lookup'), 'CypherFy never looked the room up');
  await waitFor(() => s.ofType('room.join.denied').length === 1);
  assert.equal(s.ofType('room.join.denied')[0].room.codeHash, hasher.roomCode('XK9PLM'));
  assert.equal(s.ofType('room.join.invalid').length, 0, 'a refused join is not also a guess');
});

test('denyJoin fails open when Redis is down', async (t) => {
  const s = await setup({ redisMode: 'down' });
  t.after(s.close);
  const client = await s.connect();
  client.emit('join_room', { code: 'goodrm', alias: 'eve' });
  await waitFor(() => s.handled.includes('lookup'));
});

test('a throttled socket gets about maxPerSec packets through, one SLOW_DOWN, and every packet still counted', async (t) => {
  const s = await setup();
  t.after(s.close);
  const client = await s.connect();
  assert.ok(s.layer.throttle(client.id, 3, 10_000));
  for (let i = 0; i < 20; i++) client.emit('send_message', { ciphertext: 'x' });
  await waitFor(() => client.errors.some((e) => e.code === 'SLOW_DOWN'));
  await new Promise((r) => setTimeout(r, 100));
  const passed = s.handled.filter((h) => h === 'send_message').length;
  assert.ok(passed >= 3 && passed <= 4, `passed ${passed}`);
  assert.equal(client.errors.filter((e) => e.code === 'SLOW_DOWN').length, 1, 'at most one per second');
  s.layer.flush();
  await waitFor(() => s.ofType('socket.rate').length === 1);
  assert.equal(s.ofType('socket.rate')[0].sock.total, 20, 'dropped packets still count toward R3b');
  assert.equal(s.layer.throttle('nope', 3, 10_000), null, 'unknown socket');
});

test('commands: disconnect_socket cuts the socket and acks; invalid or foreign commands do nothing', async (t) => {
  const s = await setup();
  t.after(s.close);
  const client = await s.connect();
  const subscriber = Object.assign(new EventEmitter(), { status: 'ready', subscribed: [], subscribe: async (ch) => subscriber.subscribed.push(ch) });
  createCommandService({ subscriber, layer: s.layer, ...s.ctx }).start();
  await waitFor(() => subscriber.subscribed.includes(KEYS.commands));

  subscriber.emit('message', KEYS.commands, '{not json');
  subscriber.emit('message', KEYS.commands, JSON.stringify({ v: 1, actionId: ACTION_ID, op: 'disconnect_socket', socketId: 'notOnThisInstance' }));
  subscriber.emit('message', 'other:channel', JSON.stringify({ v: 1, actionId: ACTION_ID, op: 'disconnect_socket', socketId: client.id }));
  assert.ok(s.logs.some((l) => l.msg === 'kairo.command_invalid'));
  assert.ok(client.connected);

  const id = client.id; // cleared by socket.io-client on disconnect
  const reason = new Promise((r) => client.once('disconnect', r));
  subscriber.emit('message', KEYS.commands, JSON.stringify({ v: 1, actionId: ACTION_ID, op: 'disconnect_socket', socketId: client.id }));
  assert.equal(await reason, 'io server disconnect');
  await waitFor(() => s.ofType('kairo.ack').length === 1);
  const [ack] = s.ofType('kairo.ack');
  assert.deepEqual(ack.ack, { actionId: ACTION_ID, ok: true });
  assert.equal(ack.src.socketId, id);
});

test('commands: throttle_socket installs the bucket and acks', async (t) => {
  const s = await setup();
  t.after(s.close);
  const client = await s.connect();
  const service = createCommandService({ subscriber: new EventEmitter(), layer: s.layer, ...s.ctx });
  service.handle(JSON.stringify({ v: 1, actionId: ACTION_ID, op: 'throttle_socket', socketId: client.id, maxPerSec: 3, ttlMs: 10_000 }));
  assert.equal(s.layer.stateOf(client.id).bucket.maxPerSec, 3);
  await waitFor(() => s.ofType('kairo.ack').length === 1);
});

test('a throwing emitter never breaks CypherFy: handshake, handlers and replies still work', async (t) => {
  const s = await setup({
    emitter: {
      emit() {
        throw new Error('boom');
      },
    },
  });
  t.after(s.close);
  const client = await s.connect();
  assert.ok(client.connected);
  client.emit('join_room', { code: 'badcod', alias: 'eve' });
  client.emit('send_message', { ciphertext: 'x' });
  await waitFor(() => client.errors.length === 1 && s.handled.includes('send_message'));
  s.layer.flush();
  client.close();
  await waitFor(() => s.logs.some((l) => l.msg === 'kairo.hook_error'));
});
