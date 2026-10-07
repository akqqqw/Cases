/**
 * Types of the packaging script for the tests. The script itself is plain
 * ESM JavaScript (it runs straight from `node`, without a build step), so the
 * few functions the tests exercise are declared here — with `Uint8Array`
 * instead of `Buffer`, because the browser-facing test setup has no Node types.
 */

export interface ZipInput {
  name: string;
  data: Uint8Array;
  mtime?: Date;
}

export interface InspectResult {
  errors: string[];
  warnings: string[];
  total: number;
}

export const MAX_UNPACKED_BYTES: number;
export const WARN_UNPACKED_BYTES: number;

export function crc32(buffer: Uint8Array): number;
export function buildZip(entries: ZipInput[], comment?: string): Uint8Array;
export function checkName(name: string): string | null;
export function inspectFiles(files: Array<{ name: string; data: Uint8Array; size: number }>): InspectResult;
