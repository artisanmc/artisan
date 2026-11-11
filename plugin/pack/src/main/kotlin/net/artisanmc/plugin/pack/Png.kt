package net.artisanmc.plugin.pack

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.util.zip.Inflater
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor

/** 8-bit RGBA pixels, row after row. */
class RgbaImage(val width: Int, val height: Int, val data: ByteArray = ByteArray(4 * width * height)) {
    /** Alpha of a pixel, 0..255. */
    fun alpha(x: Int, y: Int): Int = data[(y * width + x) * 4 + 3].toInt() and 0xff
}

/**
 * Minimal PNG, port of the editor's `png.ts` (itself pngjs 7's rules). Decoding: every colour
 * type, depths 1/2/4/8/16, tRNS, Adam7, to 8-bit RGBA. Encoding: 8-bit RGBA, filter chosen row by
 * row by smallest absolute sum, a single IDAT, compressed by [DeflateRle]: the bytes are the
 * editor's.
 */
object Png {
    private val SIGNATURE = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    private val CHANNELS = mapOf(0 to 1, 2 to 3, 3 to 1, 4 to 2, 6 to 4)
    private const val IHDR = 0x49484452
    private const val PLTE = 0x504c5445
    private const val IDAT = 0x49444154
    private const val IEND = 0x49454e44
    private const val TRNS = 0x74524e53

    // Adam7: start and step, in x then y, for each of the 7 passes.
    private val ADAM7 = arrayOf(
        intArrayOf(0, 8, 0, 8), intArrayOf(4, 8, 0, 8), intArrayOf(0, 4, 4, 8), intArrayOf(2, 4, 0, 4),
        intArrayOf(0, 2, 2, 4), intArrayOf(1, 2, 0, 2), intArrayOf(0, 1, 1, 2),
    )

    private val CRC_TABLE = IntArray(256) { n ->
        var c = n
        repeat(8) { c = if (c and 1 != 0) (0xedb88320.toInt() xor (c ushr 1)) else (c ushr 1) }
        c
    }

    fun crc32(bytes: ByteArray, start: Int, end: Int): Int {
        var crc = -1
        for (i in start until end) crc = CRC_TABLE[(crc xor bytes[i].toInt()) and 0xff] xor (crc ushr 8)
        return crc.inv()
    }

    /** pngjs's `PNG.bitblt`: copies a rectangle, same bounds checks. */
    fun bitblt(src: RgbaImage, dst: RgbaImage, srcX: Int, srcY: Int, width: Int, height: Int, deltaX: Int, deltaY: Int) {
        if (srcX > src.width || srcY > src.height || srcX + width > src.width || srcY + height > src.height) {
            throw IllegalArgumentException("bitblt reading outside image")
        }
        if (deltaX > dst.width || deltaY > dst.height || deltaX + width > dst.width || deltaY + height > dst.height) {
            throw IllegalArgumentException("bitblt writing outside image")
        }
        for (y in 0 until height) {
            val from = ((srcY + y) * src.width + srcX) * 4
            System.arraycopy(src.data, from, dst.data, ((deltaY + y) * dst.width + deltaX) * 4, width * 4)
        }
    }

    private fun paeth(left: Int, above: Int, upLeft: Int): Int {
        val p = left + above - upLeft
        val pLeft = abs(p - left)
        val pAbove = abs(p - above)
        val pUpLeft = abs(p - upLeft)
        if (pLeft <= pAbove && pLeft <= pUpLeft) return left
        return if (pAbove <= pUpLeft) above else upLeft
    }

    private class Pass(val width: Int, val height: Int, val x0: Int, val dx: Int, val y0: Int, val dy: Int)

    private fun passesOf(width: Int, height: Int, interlace: Boolean): List<Pass> {
        if (!interlace) return listOf(Pass(width, height, 0, 1, 0, 1))
        return ADAM7.mapNotNull { (x0, dx, y0, dy) ->
            val w = ceil((width - x0).toDouble() / dx).toInt()
            val h = ceil((height - y0).toDouble() / dy).toInt()
            if (w > 0 && h > 0) Pass(w, h, x0, dx, y0, dy) else null
        }
    }

    private fun inflate(compressed: ByteArray): ByteArray {
        val inflater = Inflater()
        try {
            inflater.setInput(compressed)
            val out = ByteArrayOutputStream(compressed.size * 4)
            val buffer = ByteArray(64 * 1024)
            while (!inflater.finished()) {
                val n = inflater.inflate(buffer)
                if (n == 0 && (inflater.needsInput() || inflater.needsDictionary())) throw IllegalArgumentException("truncated zlib data")
                out.write(buffer, 0, n)
            }
            return out.toByteArray()
        } finally {
            inflater.end()
        }
    }

    fun decode(bytes: ByteArray): RgbaImage {
        if (bytes.size < SIGNATURE.size) throw IllegalArgumentException("Invalid file signature")
        for (i in SIGNATURE.indices) if (bytes[i] != SIGNATURE[i]) throw IllegalArgumentException("Invalid file signature")
        val view = ByteBuffer.wrap(bytes)
        var width = 0
        var height = 0
        var depth = 0
        var colorType = -1
        var interlace = false
        val palette = mutableListOf<IntArray>()
        var transColor: IntArray? = null
        val idat = ByteArrayOutputStream()
        var ended = false

        var pos = 8
        while (!ended) {
            if (pos + 8 > bytes.size) throw IllegalArgumentException("truncated PNG")
            val length = view.getInt(pos).toLong() and 0xffffffffL
            val type = view.getInt(pos + 4)
            val start = pos + 8
            val endLong = start + length
            if (endLong + 4 > bytes.size) throw IllegalArgumentException("truncated PNG")
            val end = endLong.toInt()
            if (colorType < 0 && type != IHDR) throw IllegalArgumentException("Expected IHDR on beggining")
            if (crc32(bytes, pos + 4, end) != view.getInt(end)) throw IllegalArgumentException("Crc error")
            val u = { i: Int -> bytes[start + i].toInt() and 0xff }
            when {
                type == IHDR -> {
                    width = view.getInt(start)
                    height = view.getInt(start + 4)
                    depth = u(8)
                    colorType = u(9)
                    if (depth !in listOf(1, 2, 4, 8, 16)) throw IllegalArgumentException("Unsupported bit depth $depth")
                    if (colorType !in CHANNELS) throw IllegalArgumentException("Unsupported color type")
                    if (u(10) != 0) throw IllegalArgumentException("Unsupported compression method")
                    if (u(11) != 0) throw IllegalArgumentException("Unsupported filter method")
                    if (u(12) != 0 && u(12) != 1) throw IllegalArgumentException("Unsupported interlace method")
                    interlace = u(12) == 1
                }
                type == PLTE -> {
                    var i = 0
                    while (i + 3 <= end - start) {
                        palette += intArrayOf(u(i), u(i + 1), u(i + 2), 0xff)
                        i += 3
                    }
                }
                type == TRNS -> {
                    val n = end - start
                    if (colorType == 3) {
                        if (palette.isEmpty()) throw IllegalArgumentException("Transparency chunk must be after palette")
                        if (n > palette.size) throw IllegalArgumentException("More transparent colors than palette size")
                        for (i in 0 until n) palette[i][3] = u(i)
                    } else if (colorType == 0) {
                        transColor = intArrayOf(view.getShort(start).toInt() and 0xffff)
                    } else if (colorType == 2) {
                        transColor = intArrayOf(
                            view.getShort(start).toInt() and 0xffff,
                            view.getShort(start + 2).toInt() and 0xffff,
                            view.getShort(start + 4).toInt() and 0xffff,
                        )
                    }
                }
                type == IDAT -> {
                    if (colorType == 3 && palette.isEmpty()) throw IllegalArgumentException("Expected palette not found")
                    idat.write(bytes, start, end - start)
                }
                type == IEND -> ended = true
                (bytes[pos + 4].toInt() and 0x20) == 0 -> throw IllegalArgumentException("Unsupported critical chunk type")
            }
            pos = end + 4
        }
        if (pos != bytes.size) throw IllegalArgumentException("unrecognised content at end of stream")

        val raw = inflate(idat.toByteArray())
        val channels = CHANNELS.getValue(colorType)
        // Byte offset to the left pixel: a whole pixel, or one byte below 8 bits.
        val left = if (depth >= 8) channels * depth / 8 else 1
        val maxSample = (1 shl depth) - 1
        val samples = IntArray(width * height * 4)
        var rawPos = 0
        for (pass in passesOf(width, height, interlace)) {
            val byteWidth = ceil(pass.width.toDouble() * channels * depth / 8).toInt()
            var prev: IntArray? = null
            for (y in 0 until pass.height) {
                if (rawPos + byteWidth + 1 > raw.size) throw IllegalArgumentException("Ran out of data")
                val filter = raw[rawPos].toInt() and 0xff
                val line = IntArray(byteWidth)
                for (x in 0 until byteWidth) {
                    val r = raw[rawPos + 1 + x].toInt() and 0xff
                    val a = if (x >= left) line[x - left] else 0
                    val b = prev?.get(x) ?: 0
                    val c = if (prev != null && x >= left) prev[x - left] else 0
                    line[x] = when (filter) {
                        0 -> r
                        1 -> r + a
                        2 -> r + b
                        3 -> r + ((a + b) shr 1)
                        4 -> r + paeth(a, b, c)
                        else -> throw IllegalArgumentException("Unrecognised filter type - $filter")
                    } and 0xff
                }
                rawPos += byteWidth + 1
                prev = line

                var bit = 0
                val sample = {
                    val v = when (depth) {
                        16 -> (line[bit shr 3] shl 8) or line[(bit shr 3) + 1]
                        8 -> line[bit shr 3]
                        else -> (line[bit shr 3] shr (8 - depth - (bit and 7))) and maxSample
                    }
                    bit += depth
                    v
                }
                val outY = pass.y0 + y * pass.dy
                for (x in 0 until pass.width) {
                    val o = (outY * width + pass.x0 + x * pass.dx) * 4
                    if (channels <= 2) {
                        val g = sample()
                        samples[o] = g
                        samples[o + 1] = g
                        samples[o + 2] = g
                        samples[o + 3] = if (channels == 2) sample() else maxSample
                    } else {
                        samples[o] = sample()
                        samples[o + 1] = sample()
                        samples[o + 2] = sample()
                        samples[o + 3] = if (channels == 4) sample() else maxSample
                    }
                }
            }
        }
        // pngjs ignores trailing data after the last row without interlacing, not with it.
        if (interlace && rawPos != raw.size) throw IllegalArgumentException("unrecognised content at end of stream")

        val out = RgbaImage(width, height)
        var i = 0
        while (i < samples.size) {
            if (colorType == 3) {
                val color = palette.getOrNull(samples[i]) ?: throw IllegalArgumentException("index ${samples[i]} not in palette")
                for (k in 0 until 4) out.data[i + k] = color[k].toByte()
                i += 4
                continue
            }
            val t = transColor
            val transparent = t != null && if (t.size == 1) t[0] == samples[i]
            else t[0] == samples[i] && t[1] == samples[i + 1] && t[2] == samples[i + 2]
            for (k in 0 until 4) {
                val v = if (transparent) 0 else samples[i + k]
                out.data[i + k] = (if (depth == 8) v else floor(v * 255.0 / maxSample + 0.5).toInt()).toByte()
            }
            i += 4
        }
        return out
    }

    /** The five PNG filters as pngjs computes them: unwrapped differences, summed by absolute value. */
    private fun filtered(type: Int, d: ByteArray, p: Int, x: Int, w: Int): Int {
        fun at(i: Int) = d[i].toInt() and 0xff
        val left = if (x >= 4) at(p + x - 4) else 0
        val up = if (p > 0) at(p + x - w) else 0
        return when (type) {
            0 -> at(p + x)
            1 -> at(p + x) - left
            2 -> at(p + x) - up
            3 -> at(p + x) - ((left + up) shr 1)
            else -> at(p + x) - paeth(left, up, if (p > 0 && x >= 4) at(p + x - (w + 4)) else 0)
        }
    }

    private fun chunk(type: Int, data: ByteArray): ByteArray {
        val out = ByteArray(data.size + 12)
        val view = ByteBuffer.wrap(out)
        view.putInt(0, data.size)
        view.putInt(4, type)
        System.arraycopy(data, 0, out, 8, data.size)
        view.putInt(out.size - 4, crc32(out, 4, out.size - 4))
        return out
    }

    fun encode(image: RgbaImage): ByteArray {
        val width = image.width
        val height = image.height
        val data = image.data
        val byteWidth = width * 4
        val filteredBytes = ByteArray((byteWidth + 1) * height)
        var rawPos = 0
        var sel = 0
        var pos = 0
        for (y in 0 until height) {
            var min = Long.MAX_VALUE
            for (type in 0 until 5) {
                var sum = 0L
                for (x in 0 until byteWidth) sum += abs(filtered(type, data, pos, x, byteWidth))
                if (sum < min) {
                    sel = type
                    min = sum
                }
            }
            filteredBytes[rawPos++] = sel.toByte()
            for (x in 0 until byteWidth) filteredBytes[rawPos++] = filtered(sel, data, pos, x, byteWidth).toByte()
            pos += byteWidth
        }

        val ihdr = ByteArray(13)
        ByteBuffer.wrap(ihdr).putInt(0, width).putInt(4, height)
        ihdr[8] = 8
        ihdr[9] = 6
        val out = ByteArrayOutputStream()
        out.write(SIGNATURE)
        out.write(chunk(IHDR, ihdr))
        out.write(chunk(IDAT, DeflateRle.deflate(filteredBytes)))
        out.write(chunk(IEND, ByteArray(0)))
        return out.toByteArray()
    }
}
