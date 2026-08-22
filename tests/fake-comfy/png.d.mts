// Types for png.mjs, which stays plain JavaScript so the fake server can be run
// directly with node. Only what the TypeScript callers actually use.
export type Rgb = [number, number, number]

export function encodePng(
  width: number,
  height: number,
  pixelAt: (x: number, y: number) => [number, number, number, number],
): Buffer
export function solidPng(width: number, height: number, rgb: Rgb): Buffer
export function borderedPng(
  width: number,
  height: number,
  fill: Rgb,
  border: Rgb,
  borderWidth?: number,
): Buffer
export function pngSize(buf: Buffer): { width: number; height: number } | null
export function inflateSync(buf: Buffer): Buffer
