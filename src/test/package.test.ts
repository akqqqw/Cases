/**
 * Guards of `scripts/package-yandex.mjs` — the archive Yandex Games expects.
 *
 * The rules live in the requirements of the portal: one `index.html` at the
 * root of the archive (1.22), ≤ 100 MB unpacked (1.21), no spaces and no
 * Cyrillic in the names (1.22). The ZIP itself is written by hand (`node:zlib`
 * only), so the structure is checked here entry by entry: a broken central
 * directory is exactly the kind of thing that only shows up in the Console.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_UNPACKED_BYTES,
  buildZip,
  checkName,
  crc32,
  inspectFiles,
} from '../../scripts/package-yandex.mjs';

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Deterministic pseudo-random bytes — incompressible, so they are stored. */
function noise(size: number): Uint8Array {
  const out = new Uint8Array(size);
  let seed = 0x2f6e2b1;
  for (let index = 0; index < size; index += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[index] = (seed >>> 16) & 0xff;
  }
  return out;
}

describe('crc32', () => {
  it('matches the reference vectors', () => {
    expect(crc32(text(''))).toBe(0);
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
    expect(crc32(text('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

describe('buildZip', () => {
  it('writes a single entry with a valid local header and central directory', () => {
    // Repetitive enough for deflate to win, so the entry is compressed.
    const data = text('<!doctype html>\n'.repeat(40));
    const zip = buildZip([{ name: 'index.html', data, mtime: new Date(2026, 0, 5, 12, 0, 0) }]);
    const dv = view(zip);

    expect(dv.getUint32(0, true)).toBe(0x04034b50); // local file header
    expect(dv.getUint16(4, true)).toBe(20); // version needed
    expect(dv.getUint16(8, true)).toBe(8); // deflate
    expect(dv.getUint32(14, true)).toBe(crc32(data));
    expect(dv.getUint32(22, true)).toBe(data.length); // uncompressed size
    const nameLength = dv.getUint16(26, true);
    const name = new TextDecoder().decode(zip.slice(30, 30 + nameLength));
    expect(name).toBe('index.html');

    // The end-of-central-directory record closes the file.
    const end = zip.length - 22;
    expect(dv.getUint32(end, true)).toBe(0x06054b50);
    expect(dv.getUint16(end + 8, true)).toBe(1);
    expect(dv.getUint16(end + 10, true)).toBe(1);

    // One central directory entry pointing at the local header.
    const central = dv.getUint32(end + 16, true);
    expect(dv.getUint32(central, true)).toBe(0x02014b50);
    expect(dv.getUint32(central + 42, true)).toBe(0);
    expect(dv.getUint32(central + 16, true)).toBe(crc32(data));
  });

  it('stores incompressible data and compresses repetitive data', () => {
    const random = noise(128);
    const stored = buildZip([{ name: 'a.bin', data: random }]);
    const storedDv = view(stored);
    expect(storedDv.getUint16(8, true)).toBe(0); // method 0 — store
    const storedLength = storedDv.getUint32(18, true);
    expect(storedDv.getUint32(22, true)).toBe(random.length);
    expect(Array.from(stored.slice(30 + 5, 30 + 5 + random.length))).toEqual(Array.from(random));
    expect(storedLength).toBe(random.length);

    const repeated = text('A'.repeat(400));
    const packed = buildZip([{ name: 'b.txt', data: repeated }]);
    const packedDv = view(packed);
    expect(packedDv.getUint16(8, true)).toBe(8); // method 8 — deflate
    expect(packedDv.getUint32(18, true)).toBeLessThan(repeated.length);
    expect(packedDv.getUint32(22, true)).toBe(repeated.length);
    expect(packedDv.getUint32(14, true)).toBe(crc32(repeated));
  });

  it('keeps the order of the entries and counts them honestly', () => {
    const zip = buildZip([
      { name: 'assets/index-abc.js', data: text('console.log(1)') },
      { name: 'index.html', data: text('<div id="root"></div>') },
    ]);
    const dv = view(zip);
    const end = zip.length - 22;
    expect(dv.getUint16(end + 10, true)).toBe(2);

    const central = dv.getUint32(end + 16, true);
    const firstNameLength = dv.getUint16(central + 28, true);
    const firstName = new TextDecoder().decode(zip.slice(central + 46, central + 46 + firstNameLength));
    expect(firstName).toBe('assets/index-abc.js');
  });
});

describe('checkName (rules 1.22)', () => {
  it('accepts the names the portal expects', () => {
    expect(checkName('index.html')).toBeNull();
    expect(checkName('assets/index-BzFtxcae.js')).toBeNull();
    expect(checkName('images/level-1.webp')).toBeNull();
  });

  it('rejects spaces, Cyrillic, traversal and absolute paths', () => {
    expect(checkName('my game/index.html')).not.toBeNull();
    expect(checkName('игра/index.html')).not.toBeNull();
    expect(checkName('../index.html')).not.toBeNull();
    expect(checkName('/index.html')).not.toBeNull();
    expect(checkName('assets\\index.js')).not.toBeNull();
    expect(checkName('')).not.toBeNull();
  });
});

describe('inspectFiles', () => {
  const html = (body: string): { name: string; data: Uint8Array; size: number } => {
    const data = text(body);
    return { name: 'index.html', data, size: data.length };
  };

  it('accepts the build of this game', () => {
    const page = html('<!doctype html><html><head><script type="module" src="./assets/index.js"></script></head></html>');
    const js = text('export const shelfSort = 1;');
    const result = inspectFiles([page, { name: 'assets/index.js', data: js, size: js.length }]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.total).toBe(page.size + js.length);
  });

  it('demands an index.html at the very root', () => {
    const data = text('x');
    const nested = inspectFiles([{ name: 'site/index.html', data, size: 1 }]);
    expect(nested.errors.join(' ')).toContain('index.html');

    const two = inspectFiles([html('a'), { name: 'site/index.html', data, size: 1 }]);
    expect(two.errors.join(' ')).toContain('один');
  });

  it('catches absolute asset paths of a default Vite build', () => {
    const result = inspectFiles([html('<!doctype html><script type="module" src="/assets/index.js"></script>')]);
    expect(result.errors.join(' ')).toContain('--base=./');
  });

  it('stops an archive above the 100 MB limit', () => {
    const data = text('x');
    const big = inspectFiles([html('a'), { name: 'assets/huge.bin', data, size: MAX_UNPACKED_BYTES + 1 }]);
    expect(big.errors.join(' ')).toContain('100');
  });

  it('lists unexpected external resources as a warning', () => {
    const data = text('const art = "https://cdn.example.org/sprites/level-1.png";');
    const result = inspectFiles([html('a'), { name: 'assets/index.js', data, size: data.length }]);
    expect(result.errors).toEqual([]);
    expect(result.warnings.join(' ')).toContain('cdn.example.org');
  });
});
