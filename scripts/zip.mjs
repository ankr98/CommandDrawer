/**
 * Use this script to create a zip of the dist/ folder for release. The zip is store-ready:
 * - all files at the archive root (no dist/ prefix)
 * - forward slashes in paths
 * - no source maps or OS cruft 
 * Package dist/ as a store-ready zip: contents at the archive root, forward
 * slashes, no source maps or OS cruft. Pure Node, works on Windows/macOS/Linux.
 *
 *   npm run build && npm run zip   →  release/command-drawer-<version>.zip
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = resolve(root, 'dist');
const { version } = createRequire(import.meta.url)(resolve(root, 'package.json'));
const outDir = resolve(root, 'release');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `command-drawer-${version}.zip`);

const EXCLUDE = /(\.map$|\.DS_Store$|Thumbs\.db$|\.git)/;

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const files = walk(dist)
  .filter((p) => !EXCLUDE.test(p))
  .sort();
if (!files.some((p) => p.endsWith('manifest.json') && dirname(p) === dist)) throw new Error('dist/manifest.json missing — run npm run build first');

const locals = [];
const centrals = [];
let offset = 0;
const dosTime = () => {
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
};
const { time, date } = dosTime();

for (const p of files) {
  const name = Buffer.from(relative(dist, p).replaceAll(sep, '/'), 'utf8');
  const data = readFileSync(p);
  const deflated = deflateRawSync(data, { level: 9 });
  const useDeflate = deflated.length < data.length;
  const body = useDeflate ? deflated : data;
  const method = useDeflate ? 8 : 0;
  const crc = crc32(data);

  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  name.copy(local, 30);

  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(date, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(offset, 42);
  name.copy(central, 46);

  locals.push(local, body);
  centrals.push(central);
  offset += local.length + body.length;
}

const cdSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cdSize, 12);
end.writeUInt32LE(offset, 16);
writeFileSync(outFile, Buffer.concat([...locals, ...centrals, end]));

const kb = (statSync(outFile).size / 1024).toFixed(1);
console.log(`${relative(root, outFile)}  ${files.length} files, ${kb} KB`);
for (const p of files) console.log('  ' + relative(dist, p).replaceAll(sep, '/'));
