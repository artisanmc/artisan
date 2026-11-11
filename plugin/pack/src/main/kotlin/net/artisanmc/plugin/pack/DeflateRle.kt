package net.artisanmc.plugin.pack

import java.io.ByteArrayOutputStream

/**
 * `zlib.deflateSync(data, { level: 9, strategy: Z_RLE })`, byte for byte: port of the editor's
 * `deflateRle.ts`. `java.util.zip.Deflater` compresses differently, and the pack must have the
 * same bytes as the editor's (`resource-pack-conformance.json`). zlib's `deflate_rle` and
 * `trees.c` (32 KB window, memLevel 8): distance-1 matches only, one block every 16383 entries,
 * the cheapest of stored / fixed / dynamic for each.
 */
object DeflateRle {
    private const val MAX_BITS = 15
    private const val MAX_BL_BITS = 7
    private const val LITERALS = 256
    private const val END_BLOCK = 256
    private const val L_CODES = 286
    private const val D_CODES = 30
    private const val BL_CODES = 19
    private const val HEAP_SIZE = 2 * L_CODES + 1
    private const val MIN_MATCH = 3
    private const val MAX_MATCH = 258
    private const val W_SIZE = 32768
    private const val WINDOW_SIZE = 2 * W_SIZE
    private const val MIN_LOOKAHEAD = MAX_MATCH + MIN_MATCH + 1
    private const val MAX_DIST = W_SIZE - MIN_LOOKAHEAD
    private const val LIT_BUFSIZE = 1 shl (8 + 6)

    private val EXTRA_LBITS = intArrayOf(0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0)
    private val EXTRA_DBITS = intArrayOf(0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13)
    private val EXTRA_BLBITS = intArrayOf(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7)
    private val BL_ORDER = intArrayOf(16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15)

    /** A zlib-style tree: `freq` and `code` share one field, `dad` and `len` the other (uint16 in zlib). */
    private class Tree(size: Int) {
        val fc = IntArray(size)
        val dl = IntArray(size)
    }

    private fun biReverse(code: Int, len: Int): Int {
        var res = 0
        for (i in 0 until len) res = (res shl 1) or ((code ushr i) and 1)
        return res
    }

    private fun genCodes(t: Tree, maxCode: Int, blCount: IntArray) {
        val nextCode = IntArray(MAX_BITS + 1)
        var code = 0
        for (bits in 1..MAX_BITS) {
            code = (code + blCount[bits - 1]) shl 1
            nextCode[bits] = code and 0xffff
        }
        for (n in 0..maxCode) {
            val len = t.dl[n]
            if (len == 0) continue
            t.fc[n] = biReverse(nextCode[len] and 0xffff, len)
            nextCode[len] = (nextCode[len] + 1) and 0xffff
        }
    }

    private val LENGTH_CODE = IntArray(MAX_MATCH - MIN_MATCH + 1)
    private val BASE_LENGTH = IntArray(29)
    private val STATIC_LTREE = Tree(L_CODES + 2)
    private val STATIC_DTREE = Tree(D_CODES)

    init {
        var length = 0
        var code = 0
        while (code < 28) {
            BASE_LENGTH[code] = length
            for (n in 0 until (1 shl EXTRA_LBITS[code])) LENGTH_CODE[length++] = code
            code++
        }
        LENGTH_CODE[length - 1] = code
        val blCount = IntArray(MAX_BITS + 1)
        for (n in 0..143) STATIC_LTREE.dl[n] = 8
        for (n in 144..255) STATIC_LTREE.dl[n] = 9
        for (n in 256..279) STATIC_LTREE.dl[n] = 7
        for (n in 280..287) STATIC_LTREE.dl[n] = 8
        blCount[7] = 24
        blCount[8] = 152
        blCount[9] = 112
        genCodes(STATIC_LTREE, L_CODES + 1, blCount)
        for (d in 0 until D_CODES) {
            STATIC_DTREE.dl[d] = 5
            STATIC_DTREE.fc[d] = biReverse(d, 5)
        }
    }

    private class Desc(
        val dyn: Tree,
        val stree: Tree?,
        val extra: IntArray,
        val base: Int,
        val elems: Int,
        val maxLength: Int,
    ) {
        var maxCode = 0
    }

    private class Deflater {
        val out = ByteArrayOutputStream()
        var biBuf = 0
        var biValid = 0
        val dynL = Tree(HEAP_SIZE)
        val dynD = Tree(2 * D_CODES + 1)
        val bl = Tree(2 * BL_CODES + 1)
        val lDesc = Desc(dynL, STATIC_LTREE, EXTRA_LBITS, LITERALS + 1, L_CODES, MAX_BITS)
        val dDesc = Desc(dynD, STATIC_DTREE, EXTRA_DBITS, 0, D_CODES, MAX_BITS)
        val blDesc = Desc(bl, null, EXTRA_BLBITS, 0, BL_CODES, MAX_BL_BITS)
        val heap = IntArray(HEAP_SIZE)
        var heapLen = 0
        var heapMax = 0
        val depth = IntArray(HEAP_SIZE)
        val blCount = IntArray(MAX_BITS + 1)
        var optLen = 0
        var staticLen = 0

        /** Block entries: length - 3 for a match, the byte otherwise. */
        val syms = IntArray(LIT_BUFSIZE)
        val isMatch = BooleanArray(LIT_BUFSIZE)
        var symNext = 0

        init {
            initBlock()
        }

        fun initBlock() {
            for (n in 0 until L_CODES) dynL.fc[n] = 0
            for (n in 0 until D_CODES) dynD.fc[n] = 0
            for (n in 0 until BL_CODES) bl.fc[n] = 0
            dynL.fc[END_BLOCK] = 1
            optLen = 0
            staticLen = 0
            symNext = 0
        }

        fun sendBits(value: Int, length: Int) {
            biBuf = biBuf or (value shl biValid)
            biValid += length
            while (biValid >= 8) {
                out.write(biBuf and 0xff)
                biBuf = biBuf ushr 8
                biValid -= 8
            }
        }

        fun sendCode(c: Int, t: Tree) = sendBits(t.fc[c], t.dl[c])

        fun biWindup() {
            if (biValid > 0) out.write(biBuf and 0xff)
            biBuf = 0
            biValid = 0
        }

        /** True when the entry buffer is full: the block must be flushed. */
        fun tallyLit(c: Int): Boolean {
            syms[symNext] = c
            isMatch[symNext++] = false
            dynL.fc[c]++
            return symNext == LIT_BUFSIZE - 1
        }

        fun tallyRun(lc: Int): Boolean {
            syms[symNext] = lc
            isMatch[symNext++] = true
            dynL.fc[LENGTH_CODE[lc] + LITERALS + 1]++
            dynD.fc[0]++
            return symNext == LIT_BUFSIZE - 1
        }

        fun smaller(t: Tree, n: Int, m: Int): Boolean {
            val fn = t.fc[n]
            val fm = t.fc[m]
            return fn < fm || (fn == fm && depth[n] <= depth[m])
        }

        fun pqdownheap(t: Tree, start: Int) {
            var k = start
            val v = heap[k]
            var j = k shl 1
            while (j <= heapLen) {
                if (j < heapLen && smaller(t, heap[j + 1], heap[j])) j++
                if (smaller(t, v, heap[j])) break
                heap[k] = heap[j]
                k = j
                j = j shl 1
            }
            heap[k] = v
        }

        fun genBitlen(desc: Desc) {
            val t = desc.dyn
            val stree = desc.stree
            val maxLength = desc.maxLength
            val maxCode = desc.maxCode
            var overflow = 0
            blCount.fill(0)
            t.dl[heap[heapMax]] = 0
            var h = heapMax + 1
            while (h < HEAP_SIZE) {
                val n = heap[h]
                var bits = t.dl[t.dl[n]] + 1
                if (bits > maxLength) {
                    bits = maxLength
                    overflow++
                }
                t.dl[n] = bits
                h++
                if (n > maxCode) continue
                blCount[bits]++
                val xbits = if (n >= desc.base) desc.extra[n - desc.base] else 0
                val f = t.fc[n]
                optLen += f * (bits + xbits)
                if (stree != null) staticLen += f * (stree.dl[n] + xbits)
            }
            if (overflow == 0) return
            do {
                var bits = maxLength - 1
                while (blCount[bits] == 0) bits--
                blCount[bits]--
                blCount[bits + 1] += 2
                blCount[maxLength]--
                overflow -= 2
            } while (overflow > 0)
            var bits = maxLength
            while (bits != 0) {
                var n = blCount[bits]
                while (n != 0) {
                    val m = heap[--h]
                    if (m > maxCode) continue
                    if (t.dl[m] != bits) {
                        optLen += (bits - t.dl[m]) * t.fc[m]
                        t.dl[m] = bits
                    }
                    n--
                }
                bits--
            }
        }

        fun buildTree(desc: Desc) {
            val t = desc.dyn
            val stree = desc.stree
            var maxCode = -1
            heapLen = 0
            heapMax = HEAP_SIZE
            for (n in 0 until desc.elems) {
                if (t.fc[n] != 0) {
                    maxCode = n
                    heap[++heapLen] = n
                    depth[n] = 0
                } else {
                    t.dl[n] = 0
                }
            }
            while (heapLen < 2) {
                val node = if (maxCode < 2) ++maxCode else 0
                heap[++heapLen] = node
                t.fc[node] = 1
                depth[node] = 0
                optLen--
                if (stree != null) staticLen -= stree.dl[node]
            }
            desc.maxCode = maxCode
            for (n in (heapLen shr 1) downTo 1) pqdownheap(t, n)
            var node = desc.elems
            do {
                val n = heap[1]
                heap[1] = heap[heapLen--]
                pqdownheap(t, 1)
                val m = heap[1]
                heap[--heapMax] = n
                heap[--heapMax] = m
                t.fc[node] = t.fc[n] + t.fc[m]
                val dn = depth[n]
                val dm = depth[m]
                depth[node] = (if (dn >= dm) dn else dm) + 1
                t.dl[n] = node
                t.dl[m] = node
                heap[1] = node++
                pqdownheap(t, 1)
            } while (heapLen >= 2)
            heap[--heapMax] = heap[1]
            genBitlen(desc)
            genCodes(t, maxCode, blCount)
        }

        fun scanTree(t: Tree, maxCode: Int) {
            var prevlen = -1
            var nextlen = t.dl[0]
            var count = 0
            var maxCount = 7
            var minCount = 4
            if (nextlen == 0) {
                maxCount = 138
                minCount = 3
            }
            t.dl[maxCode + 1] = 0xffff
            val blf = bl.fc
            for (n in 0..maxCode) {
                val curlen = nextlen
                nextlen = t.dl[n + 1]
                if (++count < maxCount && curlen == nextlen) continue
                if (count < minCount) {
                    blf[curlen] += count
                } else if (curlen != 0) {
                    if (curlen != prevlen) blf[curlen]++
                    blf[16]++
                } else if (count <= 10) {
                    blf[17]++
                } else {
                    blf[18]++
                }
                count = 0
                prevlen = curlen
                if (nextlen == 0) {
                    maxCount = 138
                    minCount = 3
                } else if (curlen == nextlen) {
                    maxCount = 6
                    minCount = 3
                } else {
                    maxCount = 7
                    minCount = 4
                }
            }
        }

        fun sendTree(t: Tree, maxCode: Int) {
            var prevlen = -1
            var nextlen = t.dl[0]
            var count = 0
            var maxCount = 7
            var minCount = 4
            if (nextlen == 0) {
                maxCount = 138
                minCount = 3
            }
            for (n in 0..maxCode) {
                val curlen = nextlen
                nextlen = t.dl[n + 1]
                if (++count < maxCount && curlen == nextlen) continue
                if (count < minCount) {
                    do sendCode(curlen, bl) while (--count != 0)
                } else if (curlen != 0) {
                    if (curlen != prevlen) {
                        sendCode(curlen, bl)
                        count--
                    }
                    sendCode(16, bl)
                    sendBits(count - 3, 2)
                } else if (count <= 10) {
                    sendCode(17, bl)
                    sendBits(count - 3, 3)
                } else {
                    sendCode(18, bl)
                    sendBits(count - 11, 7)
                }
                count = 0
                prevlen = curlen
                if (nextlen == 0) {
                    maxCount = 138
                    minCount = 3
                } else if (curlen == nextlen) {
                    maxCount = 6
                    minCount = 3
                } else {
                    maxCount = 7
                    minCount = 4
                }
            }
        }

        fun buildBlTree(): Int {
            scanTree(dynL, lDesc.maxCode)
            scanTree(dynD, dDesc.maxCode)
            buildTree(blDesc)
            var maxBlindex = BL_CODES - 1
            while (maxBlindex >= 3) {
                if (bl.dl[BL_ORDER[maxBlindex]] != 0) break
                maxBlindex--
            }
            optLen += 3 * (maxBlindex + 1) + 5 + 5 + 4
            return maxBlindex
        }

        fun compressBlock(lt: Tree, dt: Tree) {
            for (i in 0 until symNext) {
                val lc = syms[i]
                if (!isMatch[i]) {
                    sendCode(lc, lt)
                    continue
                }
                val code = LENGTH_CODE[lc]
                sendCode(code + LITERALS + 1, lt)
                val extra = EXTRA_LBITS[code]
                if (extra != 0) sendBits(lc - BASE_LENGTH[code], extra)
                sendCode(0, dt) // distance 1: code 0, no extra bits
            }
            sendCode(END_BLOCK, lt)
        }

        /** `_tr_flush_block`; [stored] is false when the block start has left the window. */
        fun flushBlock(data: ByteArray, from: Int, storedLen: Int, stored: Boolean, last: Boolean) {
            buildTree(lDesc)
            buildTree(dDesc)
            val maxBlindex = buildBlTree()
            var optLenb = (optLen + 3 + 7) ushr 3
            val staticLenb = (staticLen + 3 + 7) ushr 3
            if (staticLenb <= optLenb) optLenb = staticLenb
            val lastBit = if (last) 1 else 0
            if (storedLen + 4 <= optLenb && stored) {
                sendBits(lastBit, 3)
                biWindup()
                val len = storedLen and 0xffff
                val nlen = storedLen.inv() and 0xffff
                out.write(len and 0xff)
                out.write(len ushr 8)
                out.write(nlen and 0xff)
                out.write(nlen ushr 8)
                out.write(data, from, storedLen)
            } else if (staticLenb == optLenb) {
                sendBits(2 + lastBit, 3)
                compressBlock(STATIC_LTREE, STATIC_DTREE)
            } else {
                sendBits(4 + lastBit, 3)
                val lcodes = lDesc.maxCode + 1
                val dcodes = dDesc.maxCode + 1
                val blcodes = maxBlindex + 1
                sendBits(lcodes - 257, 5)
                sendBits(dcodes - 1, 5)
                sendBits(blcodes - 4, 4)
                for (rank in 0 until blcodes) sendBits(bl.dl[BL_ORDER[rank]], 3)
                sendTree(dynL, lcodes - 1)
                sendTree(dynD, dcodes - 1)
                compressBlock(dynL, dynD)
            }
            initBlock()
            if (last) biWindup()
        }
    }

    private fun adler32(data: ByteArray): Long {
        var a = 1L
        var b = 0L
        var i = 0
        while (i < data.size) {
            val end = minOf(i + 5552, data.size)
            while (i < end) {
                a += data[i].toInt() and 0xff
                b += a
                i++
            }
            a %= 65521
            b %= 65521
        }
        return (b shl 16) or a
    }

    fun deflate(data: ByteArray): ByteArray {
        val s = Deflater()
        val total = data.size
        // Absolute positions: `strstart`, window start, bytes already read, block start.
        var strstart = 0
        var windowStart = 0
        var loaded = 0
        var blockStart = 0

        fun fillWindow() {
            do {
                var more = WINDOW_SIZE - (loaded - strstart) - (strstart - windowStart)
                if (strstart - windowStart >= W_SIZE + MAX_DIST) {
                    windowStart += W_SIZE
                    more += W_SIZE
                }
                if (loaded == total) break
                loaded += minOf(more, total - loaded)
            } while (loaded - strstart < MIN_LOOKAHEAD && loaded < total)
        }

        fun flush(last: Boolean) {
            s.flushBlock(data, blockStart, strstart - blockStart, blockStart >= windowStart, last)
            blockStart = strstart
        }

        while (true) {
            if (loaded - strstart <= MAX_MATCH) {
                fillWindow()
                if (loaded == strstart) break
            }
            val lookahead = loaded - strstart
            var matchLength = 0
            if (lookahead >= MIN_MATCH && strstart > 0) {
                val prev = data[strstart - 1]
                // JS reads `undefined` past the end, which never equals a byte.
                fun at(i: Int) = if (i < total) data[i] else null
                if (prev == at(strstart) && prev == at(strstart + 1) && prev == at(strstart + 2)) {
                    var q = strstart + 3
                    val end = minOf(strstart + MAX_MATCH, loaded)
                    while (q < end && data[q] == prev) q++
                    matchLength = q - strstart
                }
            }
            val bflush: Boolean
            if (matchLength >= MIN_MATCH) {
                bflush = s.tallyRun(matchLength - MIN_MATCH)
                strstart += matchLength
            } else {
                bflush = s.tallyLit(data[strstart].toInt() and 0xff)
                strstart++
            }
            if (bflush) flush(false)
        }
        flush(true)

        val body = s.out.toByteArray()
        val adler = adler32(data)
        val out = ByteArray(body.size + 6)
        out[0] = 0x78
        out[1] = 0x01
        System.arraycopy(body, 0, out, 2, body.size)
        out[out.size - 4] = (adler ushr 24).toByte()
        out[out.size - 3] = (adler ushr 16).toByte()
        out[out.size - 2] = (adler ushr 8).toByte()
        out[out.size - 1] = adler.toByte()
        return out
    }
}
