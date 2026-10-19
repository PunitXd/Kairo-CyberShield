// Builds small zip archives for tests, laid out like the ones GitHub serves
// for artifacts: deflated entries with a data descriptor (sizes zeroed in the
// local header, real sizes in the central directory).

import { crc32, deflateRawSync } from 'node:zlib';

export const makeZip = (files, { method = 8, dataDescriptor = true } = {}) => {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const data = Buffer.from(content);
    const body = method === 8 ? deflateRawSync(data) : data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(dataDescriptor ? 0x8 : 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(dataDescriptor ? 0 : crc, 14);
    local.writeUInt32LE(dataDescriptor ? 0 : body.length, 18);
    local.writeUInt32LE(dataDescriptor ? 0 : data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const descriptor = Buffer.alloc(dataDescriptor ? 16 : 0);
    if (dataDescriptor) {
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(body.length, 8);
      descriptor.writeUInt32LE(data.length, 12);
    }
    locals.push(local, nameBuf, body, descriptor);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(dataDescriptor ? 0x8 : 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length + descriptor.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
};
