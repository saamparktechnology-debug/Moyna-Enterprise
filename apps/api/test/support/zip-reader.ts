import { crc32, inflateRawSync } from 'node:zlib';

/** Reads every file out of a zip made by the report exporter, checking each file's size and checksum. */
export function readZip(buffer: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const endAt = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0) throw new Error('Not a zip file: no end record');
  const entries = buffer.readUInt16LE(endAt + 10);
  let at = buffer.readUInt32LE(endAt + 16);
  for (let i = 0; i < entries; i += 1) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('Bad central directory entry');
    const method = buffer.readUInt16LE(at + 10);
    const crc = buffer.readUInt32LE(at + 16);
    const packed = buffer.readUInt32LE(at + 20);
    const size = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const dataAt = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(dataAt, dataAt + packed);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    if (data.length !== size) throw new Error(`Wrong size for ${name}`);
    if (crc32(data) !== crc) throw new Error(`Wrong checksum for ${name}`);
    files.set(name, data);
    at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
  }
  return files;
}
