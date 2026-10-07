/** Tiny colour helpers shared by the canvas renderer and the CSS layer. */

export function hexToInt(hex: string): number {
  const clean = hex.replace('#', '');
  const value = clean.length === 3 ? clean[0]! + clean[0]! + clean[1]! + clean[1]! + clean[2]! + clean[2]! : clean.slice(0, 6);
  return Number.parseInt(value, 16);
}

export function intToHex(value: number): string {
  return `#${(value & 0xffffff).toString(16).padStart(6, '0')}`;
}

function channels(hex: string): [number, number, number] {
  const value = hexToInt(hex);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Blends two colours, `t = 0` → `a`, `t = 1` → `b`. */
export function mixColors(a: string, b: string, t: number): string {
  const [r1, g1, b1] = channels(a);
  const [r2, g2, b2] = channels(b);
  const lerp = (x: number, y: number): number => Math.round(x + (y - x) * t);
  return intToHex((lerp(r1, r2) << 16) | (lerp(g1, g2) << 8) | lerp(b1, b2));
}

/** `amount > 0` lightens, `amount < 0` darkens. */
export function shade(hex: string, amount: number): string {
  return amount >= 0 ? mixColors(hex, '#ffffff', amount) : mixColors(hex, '#000000', -amount);
}

export function withAlpha(hex: string, alpha: number): string {
  const value = hexToInt(hex);
  const cssAlpha = Math.max(0, Math.min(1, alpha));
  return `rgba(${(value >> 16) & 0xff}, ${(value >> 8) & 0xff}, ${value & 0xff}, ${cssAlpha})`;
}
