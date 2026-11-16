/**
 * Minimal QR code encoder (byte mode, error correction M, versions 1-10: up to 213 bytes), with no
 * dependency. Used only to show the authenticator enrolment link as a scannable code.
 */

// Per version (1-10), level M: [EC codewords per block, [blocks, data codewords per block][]]
const BLOCKS: [number, [number, number][]][] = [
  [10, [[1, 16]]],
  [16, [[1, 28]]],
  [26, [[1, 44]]],
  [18, [[2, 32]]],
  [24, [[2, 43]]],
  [16, [[4, 27]]],
  [18, [[4, 31]]],
  [22, [[2, 38], [2, 39]]],
  [22, [[3, 36], [2, 37]]],
  [26, [[4, 43], [1, 44]]],
];
const ALIGN: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

// GF(256) arithmetic for Reed-Solomon
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a: number, b: number) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function rsRemainder(data: number[], ecLen: number): number[] {
  let gen = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(gen.length + 1).fill(0);
    gen.forEach((c, j) => {
      next[j] ^= c;
      next[j + 1] ^= mul(c, EXP[i]);
    });
    gen = next;
  }
  const rem = new Array(ecLen).fill(0);
  for (const d of data) {
    const factor = d ^ rem.shift()!;
    rem.push(0);
    gen.slice(1).forEach((g, i) => (rem[i] ^= mul(g, factor)));
  }
  return rem;
}

function bch(value: number, poly: number, bits: number): number {
  let v = value << bits;
  const top = 31 - Math.clz32(poly);
  for (let i = 31 - Math.clz32(v); i >= top; i--) if ((v >>> i) & 1) v ^= poly << (i - top);
  return (value << bits) | v;
}

export function qrMatrix(text: string): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)];
  const version = BLOCKS.findIndex(([, groups]) => groups.reduce((s, [n, k]) => s + n * k, 0) >= bytes.length + 2) + 1;
  if (version === 0) throw new Error("QR text too long");
  const [ecLen, groups] = BLOCKS[version - 1];
  const dataCap = groups.reduce((s, [n, k]) => s + n * k, 0);

  // Bit stream: mode 0100, 8-bit length (versions 1-9) or 16-bit (10), data, terminator, padding.
  const bits: number[] = [];
  const push = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  push(4, 4);
  push(bytes.length, version >= 10 ? 16 : 8);
  bytes.forEach((b) => push(b, 8));
  push(0, Math.min(4, dataCap * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; data.length < dataCap; pad ^= 0xec ^ 0x11) data.push(pad);

  // Split into blocks, add EC, interleave.
  const blocks: { d: number[]; e: number[] }[] = [];
  let at = 0;
  for (const [n, k] of groups) {
    for (let i = 0; i < n; i++) {
      const d = data.slice(at, at + k);
      at += k;
      blocks.push({ d, e: rsRemainder(d, ecLen) });
    }
  }
  const out: number[] = [];
  const maxD = Math.max(...blocks.map((b) => b.d.length));
  for (let i = 0; i < maxD; i++) blocks.forEach((b) => i < b.d.length && out.push(b.d[i]));
  for (let i = 0; i < ecLen; i++) blocks.forEach((b) => out.push(b.e[i]));
  const stream: number[] = [];
  out.forEach((b) => push2(stream, b));
  function push2(arr: number[], v: number) {
    for (let i = 7; i >= 0; i--) arr.push((v >>> i) & 1);
  }

  const size = version * 4 + 17;
  const grid: (boolean | null)[][] = Array.from({ length: size }, () => new Array(size).fill(null));
  const set = (r: number, c: number, v: boolean) => {
    if (r >= 0 && c >= 0 && r < size && c < size) grid[r][c] = v;
  };
  const finder = (r: number, c: number) => {
    for (let dr = -1; dr <= 7; dr++)
      for (let dc = -1; dc <= 7; dc++) {
        const edge = dr === -1 || dr === 7 || dc === -1 || dc === 7;
        const ring = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        set(r + dr, c + dc, !edge && ring !== 2);
      }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);
  const pos = ALIGN[version - 1];
  for (const r of pos)
    for (const c of pos) {
      if ((r === 6 && c === 6) || (r === 6 && c === pos[pos.length - 1]) || (c === 6 && r === pos[pos.length - 1])) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  set(size - 8, 8, true); // dark module
  const reserved = grid.map((row) => row.map((v) => v !== null));
  const reserve = (r: number, c: number) => (reserved[r][c] = true);
  for (let i = 0; i < 9; i++) {
    reserve(8, i);
    reserve(i, 8);
  }
  for (let i = 0; i < 8; i++) {
    reserve(8, size - 1 - i);
    reserve(size - 1 - i, 8);
  }
  if (version >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
    reserve(i, size - 11 + j);
    reserve(size - 11 + j, i);
  }

  // Place data (zig-zag), mask 0 ((r+c) % 2 == 0).
  let idx = 0;
  for (let right = size - 1, up = true; right > 0; right -= 2, up = !up) {
    if (right === 6) right--;
    for (let n = 0; n < size; n++) {
      const r = up ? size - 1 - n : n;
      for (const c of [right, right - 1]) {
        if (reserved[r][c]) continue;
        const bit = idx < stream.length ? stream[idx++] === 1 : false;
        grid[r][c] = bit !== ((r + c) % 2 === 0);
      }
    }
  }

  // Format info: level M (00) + mask 0.
  const fmt = bch(0b00000, 0x537, 10) ^ 0x5412;
  const fbit = (i: number) => ((fmt >>> i) & 1) === 1;
  for (let i = 0; i < 15; i++) {
    const v = fbit(i);
    if (i < 6) set(i, 8, v);
    else if (i < 8) set(i + 1, 8, v);
    else set(size - 15 + i, 8, v);
    if (i < 8) set(8, size - 1 - i, v);
    else if (i < 9) set(8, 15 - i, v);
    else set(8, 14 - i, v);
  }
  if (version >= 7) {
    const info = bch(version, 0x1f25, 12);
    for (let i = 0; i < 18; i++) {
      const v = ((info >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      set(a, b, v);
      set(b, a, v);
    }
  }
  return grid.map((row) => row.map((v) => v === true));
}
