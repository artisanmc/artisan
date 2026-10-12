/**
 * `zlib.deflateSync(data, { level: 9, strategy: Z_RLE })`, octet pour octet.
 *
 * C'est ce que pngjs passe à zlib pour chaque PNG qu'il écrit. Le resource pack
 * construit dans le navigateur doit être identique, entrée par entrée, à celui du
 * backend : fflate compresse bien, mais autrement. On reproduit donc
 * `deflate_rle` et `trees.c` de zlib (fenêtre 32 Ko, memLevel 8) : correspondances
 * de distance 1 uniquement, un bloc toutes les 16383 entrées, et pour chaque bloc
 * le moins cher de stocké / fixe / dynamique, avec les arbres de Huffman de zlib.
 */
const MAX_BITS = 15;
const MAX_BL_BITS = 7;
const LITERALS = 256;
const END_BLOCK = 256;
const L_CODES = 286;
const D_CODES = 30;
const BL_CODES = 19;
const HEAP_SIZE = 2 * L_CODES + 1;
const MIN_MATCH = 3;
const MAX_MATCH = 258;
const W_SIZE = 32768;
const WINDOW_SIZE = 2 * W_SIZE;
const MIN_LOOKAHEAD = MAX_MATCH + MIN_MATCH + 1;
const MAX_DIST = W_SIZE - MIN_LOOKAHEAD;
const LIT_BUFSIZE = 1 << (8 + 6);

const EXTRA_LBITS = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const EXTRA_DBITS = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const EXTRA_BLBITS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7];
const BL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** Un arbre façon zlib : `freq` et `code` partagent un champ, `dad` et `len` l'autre. */
interface Tree {
  fc: Uint16Array;
  dl: Uint16Array;
}
const tree = (size: number): Tree => ({ fc: new Uint16Array(size), dl: new Uint16Array(size) });

function biReverse(code: number, len: number): number {
  let res = 0;
  for (let i = 0; i < len; i++) res = (res << 1) | ((code >>> i) & 1);
  return res;
}

function genCodes(t: Tree, maxCode: number, blCount: Uint16Array): void {
  const nextCode = new Uint16Array(MAX_BITS + 1);
  let code = 0;
  for (let bits = 1; bits <= MAX_BITS; bits++) {
    code = (code + (blCount[bits - 1] as number)) << 1;
    nextCode[bits] = code;
  }
  for (let n = 0; n <= maxCode; n++) {
    const len = t.dl[n] as number;
    if (len === 0) continue;
    t.fc[n] = biReverse((nextCode[len] as number) & 0xffff, len);
    nextCode[len] = (nextCode[len] as number) + 1;
  }
}

const LENGTH_CODE = new Uint8Array(MAX_MATCH - MIN_MATCH + 1);
const BASE_LENGTH = new Int32Array(29);
const STATIC_LTREE = tree(L_CODES + 2);
const STATIC_DTREE = tree(D_CODES);
{
  let length = 0;
  let code = 0;
  for (; code < 28; code++) {
    BASE_LENGTH[code] = length;
    for (let n = 0; n < 1 << (EXTRA_LBITS[code] as number); n++) LENGTH_CODE[length++] = code;
  }
  LENGTH_CODE[length - 1] = code;
  const blCount = new Uint16Array(MAX_BITS + 1);
  let n = 0;
  for (; n <= 143; n++) STATIC_LTREE.dl[n] = 8;
  for (; n <= 255; n++) STATIC_LTREE.dl[n] = 9;
  for (; n <= 279; n++) STATIC_LTREE.dl[n] = 7;
  for (; n <= 287; n++) STATIC_LTREE.dl[n] = 8;
  blCount[7] = 24;
  blCount[8] = 152;
  blCount[9] = 112;
  genCodes(STATIC_LTREE, L_CODES + 1, blCount);
  for (let d = 0; d < D_CODES; d++) {
    STATIC_DTREE.dl[d] = 5;
    STATIC_DTREE.fc[d] = biReverse(d, 5);
  }
}

interface Desc {
  dyn: Tree;
  stree: Tree | null;
  extra: number[];
  base: number;
  elems: number;
  maxLength: number;
  maxCode: number;
}

class Deflater {
  out: number[] = [];
  biBuf = 0;
  biValid = 0;
  dynL = tree(HEAP_SIZE);
  dynD = tree(2 * D_CODES + 1);
  bl = tree(2 * BL_CODES + 1);
  lDesc: Desc = {
    dyn: this.dynL,
    stree: STATIC_LTREE,
    extra: EXTRA_LBITS,
    base: LITERALS + 1,
    elems: L_CODES,
    maxLength: MAX_BITS,
    maxCode: 0,
  };
  dDesc: Desc = {
    dyn: this.dynD,
    stree: STATIC_DTREE,
    extra: EXTRA_DBITS,
    base: 0,
    elems: D_CODES,
    maxLength: MAX_BITS,
    maxCode: 0,
  };
  blDesc: Desc = {
    dyn: this.bl,
    stree: null,
    extra: EXTRA_BLBITS,
    base: 0,
    elems: BL_CODES,
    maxLength: MAX_BL_BITS,
    maxCode: 0,
  };
  heap = new Int32Array(HEAP_SIZE);
  heapLen = 0;
  heapMax = 0;
  depth = new Uint8Array(HEAP_SIZE);
  blCount = new Uint16Array(MAX_BITS + 1);
  optLen = 0;
  staticLen = 0;
  /** Entrées du bloc : longueur - 3 pour une correspondance, octet sinon. */
  syms = new Int32Array(LIT_BUFSIZE);
  isMatch = new Uint8Array(LIT_BUFSIZE);
  symNext = 0;

  constructor() {
    this.initBlock();
  }

  initBlock(): void {
    for (let n = 0; n < L_CODES; n++) this.dynL.fc[n] = 0;
    for (let n = 0; n < D_CODES; n++) this.dynD.fc[n] = 0;
    for (let n = 0; n < BL_CODES; n++) this.bl.fc[n] = 0;
    this.dynL.fc[END_BLOCK] = 1;
    this.optLen = 0;
    this.staticLen = 0;
    this.symNext = 0;
  }

  sendBits(value: number, length: number): void {
    this.biBuf |= value << this.biValid;
    this.biValid += length;
    while (this.biValid >= 8) {
      this.out.push(this.biBuf & 0xff);
      this.biBuf >>>= 8;
      this.biValid -= 8;
    }
  }

  sendCode(c: number, t: Tree): void {
    this.sendBits(t.fc[c] as number, t.dl[c] as number);
  }

  biWindup(): void {
    if (this.biValid > 0) this.out.push(this.biBuf & 0xff);
    this.biBuf = 0;
    this.biValid = 0;
  }

  /** Vrai quand le tampon d'entrées est plein : il faut vider le bloc. */
  tallyLit(c: number): boolean {
    this.syms[this.symNext] = c;
    this.isMatch[this.symNext++] = 0;
    this.dynL.fc[c] = (this.dynL.fc[c] as number) + 1;
    return this.symNext === LIT_BUFSIZE - 1;
  }

  tallyRun(lc: number): boolean {
    this.syms[this.symNext] = lc;
    this.isMatch[this.symNext++] = 1;
    const code = (LENGTH_CODE[lc] as number) + LITERALS + 1;
    this.dynL.fc[code] = (this.dynL.fc[code] as number) + 1;
    this.dynD.fc[0] = (this.dynD.fc[0] as number) + 1;
    return this.symNext === LIT_BUFSIZE - 1;
  }

  smaller(t: Tree, n: number, m: number): boolean {
    const fn = t.fc[n] as number;
    const fm = t.fc[m] as number;
    return fn < fm || (fn === fm && (this.depth[n] as number) <= (this.depth[m] as number));
  }

  pqdownheap(t: Tree, start: number): void {
    let k = start;
    const v = this.heap[k] as number;
    let j = k << 1;
    while (j <= this.heapLen) {
      if (j < this.heapLen && this.smaller(t, this.heap[j + 1] as number, this.heap[j] as number))
        j++;
      if (this.smaller(t, v, this.heap[j] as number)) break;
      this.heap[k] = this.heap[j] as number;
      k = j;
      j <<= 1;
    }
    this.heap[k] = v;
  }

  genBitlen(desc: Desc): void {
    const { dyn: t, stree, extra, base, maxLength, maxCode } = desc;
    let overflow = 0;
    this.blCount.fill(0);
    t.dl[this.heap[this.heapMax] as number] = 0;
    let h = this.heapMax + 1;
    for (; h < HEAP_SIZE; h++) {
      const n = this.heap[h] as number;
      let bits = (t.dl[t.dl[n] as number] as number) + 1;
      if (bits > maxLength) {
        bits = maxLength;
        overflow++;
      }
      t.dl[n] = bits;
      if (n > maxCode) continue;
      this.blCount[bits] = (this.blCount[bits] as number) + 1;
      const xbits = n >= base ? (extra[n - base] as number) : 0;
      const f = t.fc[n] as number;
      this.optLen += f * (bits + xbits);
      if (stree) this.staticLen += f * ((stree.dl[n] as number) + xbits);
    }
    if (overflow === 0) return;
    do {
      let bits = maxLength - 1;
      while (this.blCount[bits] === 0) bits--;
      this.blCount[bits] = (this.blCount[bits] as number) - 1;
      this.blCount[bits + 1] = (this.blCount[bits + 1] as number) + 2;
      this.blCount[maxLength] = (this.blCount[maxLength] as number) - 1;
      overflow -= 2;
    } while (overflow > 0);
    for (let bits = maxLength; bits !== 0; bits--) {
      let n = this.blCount[bits] as number;
      while (n !== 0) {
        const m = this.heap[--h] as number;
        if (m > maxCode) continue;
        if (t.dl[m] !== bits) {
          this.optLen += (bits - (t.dl[m] as number)) * (t.fc[m] as number);
          t.dl[m] = bits;
        }
        n--;
      }
    }
  }

  buildTree(desc: Desc): void {
    const { dyn: t, stree, elems } = desc;
    let maxCode = -1;
    this.heapLen = 0;
    this.heapMax = HEAP_SIZE;
    for (let n = 0; n < elems; n++) {
      if (t.fc[n] !== 0) {
        this.heap[++this.heapLen] = maxCode = n;
        this.depth[n] = 0;
      } else {
        t.dl[n] = 0;
      }
    }
    while (this.heapLen < 2) {
      const node = maxCode < 2 ? ++maxCode : 0;
      this.heap[++this.heapLen] = node;
      t.fc[node] = 1;
      this.depth[node] = 0;
      this.optLen--;
      if (stree) this.staticLen -= stree.dl[node] as number;
    }
    desc.maxCode = maxCode;
    for (let n = this.heapLen >> 1; n >= 1; n--) this.pqdownheap(t, n);
    let node = elems;
    do {
      const n = this.heap[1] as number;
      this.heap[1] = this.heap[this.heapLen--] as number;
      this.pqdownheap(t, 1);
      const m = this.heap[1] as number;
      this.heap[--this.heapMax] = n;
      this.heap[--this.heapMax] = m;
      t.fc[node] = (t.fc[n] as number) + (t.fc[m] as number);
      const dn = this.depth[n] as number;
      const dm = this.depth[m] as number;
      this.depth[node] = (dn >= dm ? dn : dm) + 1;
      t.dl[n] = node;
      t.dl[m] = node;
      this.heap[1] = node++;
      this.pqdownheap(t, 1);
    } while (this.heapLen >= 2);
    this.heap[--this.heapMax] = this.heap[1] as number;
    this.genBitlen(desc);
    genCodes(t, maxCode, this.blCount);
  }

  scanTree(t: Tree, maxCode: number): void {
    let prevlen = -1;
    let nextlen = t.dl[0] as number;
    let count = 0;
    let maxCount = 7;
    let minCount = 4;
    if (nextlen === 0) {
      maxCount = 138;
      minCount = 3;
    }
    t.dl[maxCode + 1] = 0xffff;
    const bl = this.bl.fc;
    for (let n = 0; n <= maxCode; n++) {
      const curlen = nextlen;
      nextlen = t.dl[n + 1] as number;
      if (++count < maxCount && curlen === nextlen) continue;
      if (count < minCount) bl[curlen] = (bl[curlen] as number) + count;
      else if (curlen !== 0) {
        if (curlen !== prevlen) bl[curlen] = (bl[curlen] as number) + 1;
        bl[16] = (bl[16] as number) + 1;
      } else if (count <= 10) bl[17] = (bl[17] as number) + 1;
      else bl[18] = (bl[18] as number) + 1;
      count = 0;
      prevlen = curlen;
      if (nextlen === 0) {
        maxCount = 138;
        minCount = 3;
      } else if (curlen === nextlen) {
        maxCount = 6;
        minCount = 3;
      } else {
        maxCount = 7;
        minCount = 4;
      }
    }
  }

  sendTree(t: Tree, maxCode: number): void {
    let prevlen = -1;
    let nextlen = t.dl[0] as number;
    let count = 0;
    let maxCount = 7;
    let minCount = 4;
    if (nextlen === 0) {
      maxCount = 138;
      minCount = 3;
    }
    for (let n = 0; n <= maxCode; n++) {
      const curlen = nextlen;
      nextlen = t.dl[n + 1] as number;
      if (++count < maxCount && curlen === nextlen) continue;
      if (count < minCount) {
        do this.sendCode(curlen, this.bl);
        while (--count !== 0);
      } else if (curlen !== 0) {
        if (curlen !== prevlen) {
          this.sendCode(curlen, this.bl);
          count--;
        }
        this.sendCode(16, this.bl);
        this.sendBits(count - 3, 2);
      } else if (count <= 10) {
        this.sendCode(17, this.bl);
        this.sendBits(count - 3, 3);
      } else {
        this.sendCode(18, this.bl);
        this.sendBits(count - 11, 7);
      }
      count = 0;
      prevlen = curlen;
      if (nextlen === 0) {
        maxCount = 138;
        minCount = 3;
      } else if (curlen === nextlen) {
        maxCount = 6;
        minCount = 3;
      } else {
        maxCount = 7;
        minCount = 4;
      }
    }
  }

  buildBlTree(): number {
    this.scanTree(this.dynL, this.lDesc.maxCode);
    this.scanTree(this.dynD, this.dDesc.maxCode);
    this.buildTree(this.blDesc);
    let maxBlindex = BL_CODES - 1;
    for (; maxBlindex >= 3; maxBlindex--) {
      if (this.bl.dl[BL_ORDER[maxBlindex] as number] !== 0) break;
    }
    this.optLen += 3 * (maxBlindex + 1) + 5 + 5 + 4;
    return maxBlindex;
  }

  compressBlock(lt: Tree, dt: Tree): void {
    for (let i = 0; i < this.symNext; i++) {
      const lc = this.syms[i] as number;
      if (!this.isMatch[i]) {
        this.sendCode(lc, lt);
        continue;
      }
      const code = LENGTH_CODE[lc] as number;
      this.sendCode(code + LITERALS + 1, lt);
      const extra = EXTRA_LBITS[code] as number;
      if (extra !== 0) this.sendBits(lc - (BASE_LENGTH[code] as number), extra);
      this.sendCode(0, dt); // distance 1 : code 0, sans bits supplémentaires
    }
    this.sendCode(END_BLOCK, lt);
  }

  /** `_tr_flush_block` ; `stored` est null quand le début du bloc a quitté la fenêtre. */
  flushBlock(stored: Uint8Array | null, storedLen: number, last: boolean): void {
    this.buildTree(this.lDesc);
    this.buildTree(this.dDesc);
    const maxBlindex = this.buildBlTree();
    let optLenb = (this.optLen + 3 + 7) >>> 3;
    const staticLenb = (this.staticLen + 3 + 7) >>> 3;
    if (staticLenb <= optLenb) optLenb = staticLenb;
    const lastBit = last ? 1 : 0;
    if (storedLen + 4 <= optLenb && stored !== null) {
      this.sendBits(lastBit, 3);
      this.biWindup();
      const len = storedLen & 0xffff;
      const nlen = ~storedLen & 0xffff;
      this.out.push(len & 0xff, len >>> 8, nlen & 0xff, nlen >>> 8);
      for (const byte of stored) this.out.push(byte);
    } else if (staticLenb === optLenb) {
      this.sendBits(2 + lastBit, 3);
      this.compressBlock(STATIC_LTREE, STATIC_DTREE);
    } else {
      this.sendBits(4 + lastBit, 3);
      const lcodes = this.lDesc.maxCode + 1;
      const dcodes = this.dDesc.maxCode + 1;
      const blcodes = maxBlindex + 1;
      this.sendBits(lcodes - 257, 5);
      this.sendBits(dcodes - 1, 5);
      this.sendBits(blcodes - 4, 4);
      for (let rank = 0; rank < blcodes; rank++) {
        this.sendBits(this.bl.dl[BL_ORDER[rank] as number] as number, 3);
      }
      this.sendTree(this.dynL, lcodes - 1);
      this.sendTree(this.dynD, dcodes - 1);
      this.compressBlock(this.dynL, this.dynD);
    }
    this.initBlock();
    if (last) this.biWindup();
  }
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; ) {
    const end = Math.min(i + 5552, data.length);
    for (; i < end; i++) {
      a += data[i] as number;
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

export function deflateRle(data: Uint8Array): Uint8Array {
  const s = new Deflater();
  const total = data.length;
  // Positions absolues : `strstart`, début de fenêtre, octets déjà lus, début de bloc.
  let strstart = 0;
  let windowStart = 0;
  let loaded = 0;
  let blockStart = 0;

  const fillWindow = () => {
    do {
      let more = WINDOW_SIZE - (loaded - strstart) - (strstart - windowStart);
      if (strstart - windowStart >= W_SIZE + MAX_DIST) {
        windowStart += W_SIZE;
        more += W_SIZE;
      }
      if (loaded === total) break;
      loaded += Math.min(more, total - loaded);
    } while (loaded - strstart < MIN_LOOKAHEAD && loaded < total);
  };
  const flush = (last: boolean) => {
    const stored = blockStart >= windowStart ? data.subarray(blockStart, strstart) : null;
    s.flushBlock(stored, strstart - blockStart, last);
    blockStart = strstart;
  };

  for (;;) {
    if (loaded - strstart <= MAX_MATCH) {
      fillWindow();
      if (loaded === strstart) break;
    }
    const lookahead = loaded - strstart;
    let matchLength = 0;
    if (lookahead >= MIN_MATCH && strstart > 0) {
      const prev = data[strstart - 1];
      if (prev === data[strstart] && prev === data[strstart + 1] && prev === data[strstart + 2]) {
        let q = strstart + 3;
        const end = Math.min(strstart + MAX_MATCH, loaded);
        while (q < end && data[q] === prev) q++;
        matchLength = q - strstart;
      }
    }
    let bflush: boolean;
    if (matchLength >= MIN_MATCH) {
      bflush = s.tallyRun(matchLength - MIN_MATCH);
      strstart += matchLength;
    } else {
      bflush = s.tallyLit(data[strstart] as number);
      strstart++;
    }
    if (bflush) flush(false);
  }
  flush(true);

  const adler = adler32(data);
  const out = new Uint8Array(s.out.length + 6);
  out[0] = 0x78;
  out[1] = 0x01;
  out.set(s.out, 2);
  out[out.length - 4] = adler >>> 24;
  out[out.length - 3] = (adler >>> 16) & 0xff;
  out[out.length - 2] = (adler >>> 8) & 0xff;
  out[out.length - 1] = adler & 0xff;
  return out;
}
