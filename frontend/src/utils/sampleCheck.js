// A plain check of what the Privacy screen shows (BRIEF principle 3): scan
// the raw events for anything that looks like an IP address, an email or a
// CypherFy room code. It only checks this sample; the guarantee itself is the
// strict schema, which has no field that could hold those.

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const IPV6 = /\b(?:[0-9a-f]{1,4}:){3,}[0-9a-f]{0,4}\b|::ffff:/i;
const EMAIL = /[^\s"@]+@[^\s"@]+\.[^\s"@]+/;
const ROOM_CODE = /"[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}"/; // CypherFy's 6-character code alphabet, as a JSON value

export const checkSample = (events) => {
  const text = JSON.stringify(events);
  return {
    count: events.length,
    ipAddress: IPV4.test(text) || IPV6.test(text),
    email: EMAIL.test(text),
    roomCode: ROOM_CODE.test(text),
  };
};
