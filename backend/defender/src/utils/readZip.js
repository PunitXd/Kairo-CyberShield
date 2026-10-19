// Minimal in-memory zip reader for GitHub Actions artifacts (a few small JSON
// reports). Reads the central directory, so entries written with data
// descriptors (sizes zeroed in the local header) work. Supports stored and
// deflated entries only; ZIP64, encryption and anything over maxEntryBytes
// are refused, so a hostile archive can't exhaust memory.

import { inflateRawSync } from 'node:zlib';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

const findEndOfCentralDirectory = (buf) => {
  // The EOCD record is 22 bytes plus an optional comment of up to 64 KB.
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) return i;
  }
  throw new Error('zip: end of central directory not found');
};

/** → [{ name, data: Buffer }] for every file entry (directories skipped). */
export const readZip = (buf, { maxEntryBytes = 1_000_000, maxEntries = 20 } = {}) => {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('zip: not a zip archive');
  const eocd = findEndOfCentralDirectory(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count > maxEntries) throw new Error(`zip: too many entries (${count})`);

  const entries = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL) throw new Error('zip: bad central directory');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;
    if (flags & 0x1) throw new Error('zip: encrypted entries are not supported');
    if ([compSize, size, localOffset].includes(0xffffffff)) throw new Error('zip: ZIP64 is not supported');
    if (size > maxEntryBytes) throw new Error(`zip: entry too large (${size} bytes)`);

    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL) throw new Error('zip: bad local header');
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(start, start + compSize);
    if (raw.length !== compSize) throw new Error('zip: truncated entry');

    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: maxEntryBytes });
    else throw new Error(`zip: compression method ${method} is not supported`);
    if (data.length !== size) throw new Error('zip: size mismatch');
    entries.push({ name, data });
  }
  return entries;
};
