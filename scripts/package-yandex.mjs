#!/usr/bin/env node
/**
 * Packs the built game into the very archive the Yandex Games Console expects.
 *
 * What the docs require (`concepts/requirements`, items 1.21 / 1.22 and
 * `console/add-new-game`):
 *   1. one ZIP for every platform and language;
 *   2. the unpacked content is at most 100 MB;
 *   3. exactly one `index.html` **at the root** of the archive;
 *   4. no spaces and no Cyrillic characters in file or folder names;
 *   5. the archive is uploaded in the Console → General → Archive;
 *   6. almost all of the game must live inside the archive (an external host
 *      needs a written approval), so the script lists every external URL it
 *      finds in the build — a quiet check, not a blocker.
 *
 * The build itself is done with a relative base (`vite build --base=./`), so
 * the assets resolve from wherever the portal serves the archive; the script
 * verifies that no absolute `/assets/...` reference slipped back in.
 *
 * Usage:
 *   npm run package                     # build + pack into artifacts/
 *   node scripts/package-yandex.mjs --check        # validate dist/ only
 *   node scripts/package-yandex.mjs --out=my.zip   # custom path
 *   node scripts/package-yandex.mjs --dir=dist-prod
 *
 * Written with `node:zlib` only: no external binary (`zip`) and no dependency,
 * so `npm run package` behaves the same on any machine.
 */
import { deflateRawSync } from 'node:zlib';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Hard limit of the portal (item 1.21) and the point where we start warning. */
export const MAX_UNPACKED_BYTES = 100 * 1024 * 1024;
export const WARN_UNPACKED_BYTES = 90 * 1024 * 1024;
const DEFAULT_DIR = 'dist';
const DEFAULT_OUT = path.join('artifacts', 'shelf-sort-yandex.zip');
const ZIP_COMMENT = '';
/** `1996-01-01 00:00:00`, the DOS epoch used for files without a timestamp. */
const DOS_MIN_YEAR = 1980;

// --------------------------------------------------------------------- CRC32

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** Classic CRC-32 (the one ZIP stores in every entry). */
export function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------------------ ZIP writer

/** MS-DOS timestamp of a ZIP entry. */
function dosStamp(date) {
  const year = Math.max(DOS_MIN_YEAR, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f),
    date: ((year - DOS_MIN_YEAR) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * Builds a ZIP archive in memory. `entries` is `[{ name, data, mtime? }]` with
 * forward slashes in the names and no leading slash — exactly how the portal
 * reads them.
 */
export function buildZip(entries, comment = ZIP_COMMENT) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const packed = deflateRawSync(raw, { level: 9 });
    const useDeflate = packed.length < raw.length;
    const body = useDeflate ? packed : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);
    const stamp = dosStamp(entry.mtime instanceof Date ? entry.mtime : new Date());

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed to extract
    header.writeUInt16LE(0x0800, 6); // UTF-8 filenames (the names stay ASCII)
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(stamp.time, 10);
    header.writeUInt16LE(stamp.date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);
    parts.push(header, nameBuf, body);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4); // version made by
    record.writeUInt16LE(20, 6); // version needed
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(method, 10);
    record.writeUInt16LE(stamp.time, 12);
    record.writeUInt16LE(stamp.date, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(raw.length, 24);
    record.writeUInt16LE(nameBuf.length, 28);
    record.writeUInt16LE(0, 30); // extra
    record.writeUInt16LE(0, 32); // comment
    record.writeUInt16LE(0, 34); // disk
    record.writeUInt16LE(0, 36); // internal attributes
    record.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attributes — a plain file
    record.writeUInt32LE(offset, 42);
    central.push(record, nameBuf);

    offset += header.length + nameBuf.length + body.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const commentBuf = Buffer.from(comment, 'utf8');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(commentBuf.length, 20);

  return Buffer.concat([...parts, ...central, end, commentBuf]);
}

// ------------------------------------------------------------------- reading

/** Every file of `dir`, recursively, as `{ name, data, mtime }` and sorted. */
export function collectFiles(dir, base = dir) {
  const files = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      files.push(...collectFiles(full, base));
      continue;
    }
    if (!info.isFile()) continue;
    const name = path.relative(base, full).split(path.sep).join('/');
    files.push({ name, data: readFileSync(full), mtime: info.mtime, size: info.size });
  }
  return files;
}

// ---------------------------------------------------------------- validation

const CYRILLIC = /[\u0400-\u04ff]/;
const ABSOLUTE_REF = /(?:src|href)\s*=\s*["']\/(?!\/)/;
/**
 * Only URLs that load a resource count: `https://example.com/page` inside a
 * library error message is not a game asset, while `…/sprite.png` is.
 */
const RESOURCE_URL = /https?:\/\/[^\s"'`)\]]+?\.(?:png|jpe?g|gif|webp|avif|svg|mp3|ogg|wav|m4a|aac|json|js|mjs|css|woff2?|ttf|otf|bin|atlas)/gi;
const URL_HOST = /^https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/i;
/** Hosts that may stay external: the portal serves them, or they are mocks. */
const KNOWN_HOSTS = new Set([
  'yandex.ru',
  'yandex.com',
  'yastatic.net', // currency icons of the payments catalog
  'storage.yandexcloud.net',
  'example.com', // the placeholder of the local mock SDK (?sdk=mock)
  'localhost',
]);

/** A name the portal accepts: no spaces, no Cyrillic, no traversal. */
export function checkName(name) {
  if (name.length === 0) return 'пустое имя';
  if (name.startsWith('/')) return 'имя начинается со слэша';
  if (name.includes('..')) return 'имя содержит «..»';
  if (name.includes('\\')) return 'обратный слэш вместо «/»';
  if (/\s/.test(name)) return 'пробел в имени';
  if (CYRILLIC.test(name)) return 'кириллица в имени';
  // eslint-disable-next-line no-control-regex
  if (/[^\u0020-\u007e]/.test(name)) return 'не-ASCII символ в имени';
  return null;
}

/**
 * Runs every portal rule over a set of files. Returns errors (blocking) and
 * warnings (the developer should look at them).
 */
/** Text of a file: `Buffer` in Node, a plain `Uint8Array` from a caller. */
function asText(data) {
  return Buffer.isBuffer(data) ? data.toString('utf8') : new TextDecoder('utf-8').decode(data);
}

export function inspectFiles(files) {
  const errors = [];
  const warnings = [];
  const total = files.reduce((sum, file) => sum + file.size, 0);

  if (files.length === 0) errors.push('в сборке нет ни одного файла');
  if (!files.some((file) => file.name === 'index.html')) {
    errors.push('в корне архива нет index.html (item 1.22)');
  }
  const indexFiles = files.filter((file) => path.posix.basename(file.name) === 'index.html');
  if (indexFiles.length > 1) {
    errors.push(`index.html должен быть один, найдено ${indexFiles.length}`);
  }

  for (const file of files) {
    const problem = checkName(file.name);
    if (problem) errors.push(`${file.name}: ${problem}`);
  }

  const index = files.find((file) => file.name === 'index.html');
  if (index) {
    const html = asText(index.data);
    if (ABSOLUTE_REF.test(html)) {
      errors.push('index.html ссылается на «/…» — сборка должна быть с относительными путями (vite build --base=./)');
    }
  }

  if (total > MAX_UNPACKED_BYTES) {
    errors.push(
      `распакованный размер ${(total / 1024 / 1024).toFixed(1)} МБ больше лимита 100 МБ (item 1.21)`,
    );
  } else if (total > WARN_UNPACKED_BYTES) {
    warnings.push(
      `распакованный размер ${(total / 1024 / 1024).toFixed(1)} МБ — близко к лимиту 100 МБ (item 1.21)`,
    );
  }

  // Everything must come from the archive (item 1.22): list what does not.
  const hosts = new Set();
  for (const file of files) {
    if (!/\.(js|mjs|css|html|json|svg)$/.test(file.name)) continue;
    const text = asText(file.data);
    for (const match of text.matchAll(RESOURCE_URL)) {
      const parsed = URL_HOST.exec(match[0]);
      const host = (parsed?.[1] ?? '').toLowerCase();
      if (host.length === 0) continue;
      if ([...KNOWN_HOSTS].some((known) => host === known || host.endsWith(`.${known}`))) continue;
      hosts.add(host);
    }
  }
  if (hosts.size > 0) {
    warnings.push(
      `внешние ресурсы в сборке: ${[...hosts].sort().slice(0, 8).join(', ')} — данные игры должны лежать в архиве, чужие хосты требуют согласования`,
    );
  }

  return { errors, warnings, total };
}

// ----------------------------------------------------------------------- CLI

function parseArgs(argv) {
  const options = { dir: DEFAULT_DIR, out: DEFAULT_OUT, check: false, quiet: false };
  for (const arg of argv) {
    if (arg === '--check') options.check = true;
    else if (arg === '--quiet') options.quiet = true;
    else if (arg.startsWith('--dir=')) options.dir = arg.slice('--dir='.length);
    else if (arg.startsWith('--out=')) options.out = arg.slice('--out='.length);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else options.unknown = arg;
  }
  return options;
}

const CHECKLIST = [
  'Console → Черновик → General → Archive: загрузить этот ZIP (один на все платформы).',
  'Console → Покупки: те же id, что в src/platform/purchases.ts: coins_small, coins_big,',
  '  boosters_pack, starter_pack, remove_ads — иначе магазин их не покажет.',
  'Console → Реклама: «межстраничная реклама», «ролики за награду» и галочка управления баннером.',
  'Console → Флаги: ads_min_interval_min, ads_levels_between, ads_max_per_session,',
  '  ad_reward_coins, ad_rewards_per_day, coins_multiplier (значения по умолчанию уже в игре).',
  'Console → Лидерборды: shelf_mastery, shelf_stars3, shelf_week (technical names точь-в-точь).',
  'Console → Черновик: галочка «Облачные сохранения».',
  'Проверка: `?sdk=mock` показывает мок-платформу (5 товаров, 3 таблицы, мок-флаги).',
];

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('node scripts/package-yandex.mjs [--dir=dist] [--out=artifacts/shelf-sort-yandex.zip] [--check]');
    return 0;
  }
  if (options.unknown) {
    console.error(`Неизвестный аргумент: ${options.unknown}`);
    return 1;
  }

  const dir = path.resolve(process.cwd(), options.dir);
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`Нет папки сборки ${options.dir}. Сначала соберите проект: npm run build -- --base=./`);
    return 1;
  }

  const files = collectFiles(dir);
  const { errors, warnings, total } = inspectFiles(files);

  console.log(`Сборка: ${options.dir} — файлов ${files.length}, распакованный размер ${(total / 1024 / 1024).toFixed(2)} МБ`);
  for (const file of files) {
    console.log(`  ${file.name} — ${(file.size / 1024).toFixed(1)} КБ`);
  }
  for (const warning of warnings) console.warn(`  ⚠ ${warning}`);

  if (errors.length > 0) {
    for (const error of errors) console.error(`  ✖ ${error}`);
    console.error('Архив не собран: сначала исправьте ошибки выше.');
    return 1;
  }

  if (options.check) {
    console.log('  ✔ проверка пройдена, архив не собирался (--check)');
    return 0;
  }

  const zip = buildZip(files.map((file) => ({ name: file.name, data: file.data, mtime: file.mtime })));
  const out = path.resolve(process.cwd(), options.out);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, zip);

  console.log(`  ✔ архив: ${options.out} — ${(zip.length / 1024 / 1024).toFixed(2)} МБ (распаковка ${(total / 1024 / 1024).toFixed(2)} МБ из 100 МБ)`);
  if (!options.quiet) {
    console.log('Что осталось сделать в консоли:');
    for (const line of CHECKLIST) console.log(`  ${line}`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
