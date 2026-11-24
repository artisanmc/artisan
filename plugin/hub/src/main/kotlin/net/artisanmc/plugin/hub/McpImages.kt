package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import net.artisanmc.plugin.pack.Png
import net.artisanmc.plugin.pack.RgbaImage
import java.awt.image.BufferedImage
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.util.Base64
import javax.imageio.IIOImage
import javax.imageio.ImageIO
import javax.imageio.ImageWriteParam
import javax.imageio.stream.MemoryCacheImageInputStream
import javax.imageio.stream.MemoryCacheImageOutputStream
import kotlin.math.ceil

/**
 * The images an AI writes into a draft (ADR `mcp-server`, decision 10): pixels it wrote itself, as
 * a palette and rows of characters, or a PNG it made elsewhere. Pure: nothing here runs what a
 * model sends, it only reads data within [MAX_SIDE] and [MAX_BYTES].
 */
object McpImages {
    /** A menu's window is 176 wide and at most 222 high; a title image may be wider. */
    const val MAX_SIDE = 512
    /** An image file's size, as the editor's upload limits it. */
    const val MAX_BYTES = 2 * 1024 * 1024
    /** A picture an image is cut from (a screenshot, a mock-up) may be larger than an image: 2560x1600 at most. */
    const val MAX_SOURCE_PIXELS = 4_200_000
    /** Beyond this a picture shown under a ruler goes as a JPEG: it is looked at, not written. */
    private const val MAX_RULER_PNG = 400_000
    private val SOURCE_FORMATS = setOf("png", "jpeg", "gif")
    /** Beyond this an image does not go back as text ([grid]): too long to read, and to rewrite. */
    private const val MAX_GRID_PIXELS = 4096
    private const val PREVIEW_SIDE = 256
    private const val MAX_SCALE = 16
    private val HEX = Regex("#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?")
    /** The characters [grid] names colours with, `.` kept for transparent. */
    private const val KEYS = "#abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+*=-~^%@&$"

    /** An image for the model to look at: PNG bytes, in base64. */
    class Picture(val base64: String, val mediaType: String = "image/png")

    /**
     * The image `pixels` describes: `palette` maps one character to `#RRGGBB`, `#RRGGBBAA` or
     * `transparent`; `rows` is the image top to bottom, one string per row, one character per
     * pixel. `.` is transparent unless the palette says otherwise.
     */
    fun fromPixels(pixels: JsonNode): RgbaImage {
        val palette = HashMap<Char, Int>()
        palette['.'] = 0
        pixels.path("palette").fields().forEach { (key, value) ->
            if (key.length != 1) refuse("palette key '$key' must be one character.")
            val colour = value.asText("")
            palette[key[0]] = when {
                colour == "transparent" -> 0
                HEX.matches(colour) -> colour.drop(1).let { hex -> (hex.padEnd(8, 'f')).toLong(16).toInt() }
                else -> refuse("palette colour '$colour' must be #RRGGBB, #RRGGBBAA or transparent.")
            }
        }
        val node = pixels.path("rows")
        val rows = when {
            node.isArray -> node.map { it.asText("") }
            node.isTextual -> node.asText().trim('\n').split('\n')
            else -> refuse("pixels.rows is required: one string per row of the image.")
        }
        val height = rows.size
        val width = rows.firstOrNull()?.length ?: 0
        if (width !in 1..MAX_SIDE || height !in 1..MAX_SIDE) refuse("an image is 1 to $MAX_SIDE pixels on each side, this one is ${width}x$height.")
        val image = RgbaImage(width, height)
        rows.forEachIndexed { y, row ->
            if (row.length != width) refuse("row ${y + 1} has ${row.length} characters, row 1 has $width: every row is one character per pixel.")
            row.forEachIndexed { x, key ->
                val rgba = palette[key] ?: refuse("row ${y + 1}, column ${x + 1}: '$key' is not in the palette.")
                ByteBuffer.wrap(image.data, (y * width + x) * 4, 4).putInt(rgba)
            }
        }
        return image
    }

    /** A PNG's pixels, its size read from the header before anything is allocated for it. */
    fun fromPng(bytes: ByteArray): RgbaImage {
        if (bytes.size > MAX_BYTES) refuse("an image file is at most ${MAX_BYTES / 1024 / 1024} MB.")
        if (bytes.size < 24) refuse("this is not a PNG file.")
        val header = ByteBuffer.wrap(bytes)
        val width = header.getInt(16)
        val height = header.getInt(20)
        if (width !in 1..MAX_SIDE || height !in 1..MAX_SIDE) refuse("an image is 1 to $MAX_SIDE pixels on each side, this one is ${width}x$height.")
        return try {
            Png.decode(bytes)
        } catch (e: Exception) {
            refuse("this PNG cannot be read: ${e.message}")
        }
    }

    fun fromBase64(text: String): RgbaImage {
        val bytes = runCatching { Base64.getDecoder().decode(text.substringAfter("base64,").filterNot(Char::isWhitespace)) }.getOrNull()
            ?: refuse("png_base64 is not base64.")
        return fromPng(bytes)
    }

    /**
     * A picture to cut images from: a PNG, a JPEG or a GIF's first frame, read by the JDK, its size
     * taken from the header before anything is allocated for its pixels.
     */
    fun source(bytes: ByteArray): RgbaImage {
        val stream = MemoryCacheImageInputStream(ByteArrayInputStream(bytes))
        val reader = ImageIO.getImageReaders(stream).asSequence().firstOrNull { it.formatName.lowercase() in SOURCE_FORMATS }
            ?: refuse("this picture is not a PNG, a JPEG or a GIF: ask for it in one of those formats.")
        try {
            reader.setInput(stream, true, true)
            val width = reader.getWidth(0)
            val height = reader.getHeight(0)
            if (width < 1 || height < 1 || width.toLong() * height > MAX_SOURCE_PIXELS)
                refuse("a picture to cut from is at most $MAX_SOURCE_PIXELS pixels (2560x1600), this one is ${width}x$height: ask for a smaller one, or for the part that matters.")
            val read = reader.read(0)
            val image = RgbaImage(width, height)
            val row = IntArray(width)
            val out = ByteBuffer.wrap(image.data)
            for (y in 0 until height) {
                read.getRGB(0, y, width, 1, row, 0, width)
                // ARGB to RGBA.
                for (argb in row) out.putInt((argb shl 8) or (argb ushr 24))
            }
            return image
        } catch (e: McpRefusal) {
            throw e
        } catch (e: Exception) {
            refuse("this picture cannot be read: ${e.message}")
        } finally {
            reader.dispose()
        }
    }

    /** True for a JPEG: its flat colours are no longer flat. */
    fun lossy(bytes: ByteArray): Boolean = bytes.size > 2 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xD8.toByte()

    /**
     * An opaque picture a model only looks at (a picture under its ruler), as small as it goes: a
     * PNG the JDK compresses, or a JPEG when the PNG is heavy (a screenshot of the game's world).
     */
    fun compact(image: RgbaImage): Picture {
        val buffered = BufferedImage(image.width, image.height, BufferedImage.TYPE_INT_RGB)
        val row = IntArray(image.width)
        val pixels = ByteBuffer.wrap(image.data)
        for (y in 0 until image.height) {
            for (x in 0 until image.width) row[x] = pixels.getInt() ushr 8
            buffered.setRGB(0, y, image.width, 1, row, 0, image.width)
        }
        val png = ByteArrayOutputStream().also { ImageIO.write(buffered, "png", it) }.toByteArray()
        if (png.size <= MAX_RULER_PNG) return Picture(Base64.getEncoder().encodeToString(png))
        val writer = ImageIO.getImageWritersByFormatName("jpeg").asSequence().firstOrNull() ?: return Picture(Base64.getEncoder().encodeToString(png))
        val jpeg = ByteArrayOutputStream()
        try {
            MemoryCacheImageOutputStream(jpeg).use { out ->
                writer.output = out
                val quality = writer.defaultWriteParam.apply {
                    compressionMode = ImageWriteParam.MODE_EXPLICIT
                    compressionQuality = 0.85f
                }
                writer.write(null, IIOImage(buffered, null, null), quality)
            }
        } finally {
            writer.dispose()
        }
        return if (jpeg.size() < png.size) Picture(Base64.getEncoder().encodeToString(jpeg.toByteArray()), "image/jpeg") else Picture(Base64.getEncoder().encodeToString(png))
    }

    /**
     * [image] for a model's eyes: each pixel a square of [scale] (a 16x16 icon is unreadable at its
     * own size), over a dark chequerboard where it is transparent.
     */
    fun preview(image: RgbaImage): Picture {
        val scale = scale(image)
        val out = RgbaImage(image.width * scale, image.height * scale)
        for (y in 0 until image.height) for (x in 0 until image.width) {
            val at = (y * image.width + x) * 4
            val alpha = image.data[at + 3].toInt() and 0xff
            val under = if ((x / 2 + y / 2) % 2 == 0) 0x3a else 0x4a
            val pixel = ByteArray(4)
            for (c in 0..2) pixel[c] = (((image.data[at + c].toInt() and 0xff) * alpha + under * (255 - alpha)) / 255).toByte()
            pixel[3] = 0xff.toByte()
            for (dy in 0 until scale) for (dx in 0 until scale)
                System.arraycopy(pixel, 0, out.data, ((y * scale + dy) * out.width + x * scale + dx) * 4, 4)
        }
        return Picture(Base64.getEncoder().encodeToString(Png.encode(out)))
    }

    fun scale(image: RgbaImage): Int = ceil(PREVIEW_SIDE.toDouble() / maxOf(image.width, image.height)).toInt().coerceIn(1, MAX_SCALE)

    /** What the pixels say that a model should know before it uses the image: size, colours, soft edges. */
    fun facts(image: RgbaImage): Map<String, Any?> {
        val colours = HashSet<Int>()
        var translucent = 0
        var opaque = 0
        val pixels = ByteBuffer.wrap(image.data)
        repeat(image.width * image.height) {
            val rgba = pixels.getInt()
            when (rgba and 0xff) {
                0 -> Unit
                0xff -> { opaque++; colours += rgba }
                else -> { translucent++; colours += rgba }
            }
        }
        return mapOf(
            "width" to image.width, "height" to image.height, "colours" to colours.size, "opaque_pixels" to opaque,
            "translucent_pixels" to translucent.takeIf { it > 0 },
            "note" to "Some pixels are partly transparent: pixel art in a menu reads best with alpha at 0 or 255.".takeIf { translucent > 0 },
        ).filterValues { it != null }
    }

    /** How many opaque pixels [image] has of each colour (0xRRGGBB). */
    fun colours(image: RgbaImage): Map<Int, Long> {
        val out = HashMap<Int, Long>()
        val pixels = ByteBuffer.wrap(image.data)
        repeat(image.width * image.height) {
            val rgba = pixels.getInt()
            if (rgba and 0xff == 0xff) out.merge(rgba ushr 8, 1L, Long::plus)
        }
        return out
    }

    /** [image] as [fromPixels] reads it, to change a few pixels and write it back; null when it is too large or has too many colours. */
    fun grid(image: RgbaImage): Map<String, Any?>? {
        if (image.width * image.height > MAX_GRID_PIXELS) return null
        val keys = LinkedHashMap<Int, Char>()
        val pixels = ByteBuffer.wrap(image.data)
        val rows = (0 until image.height).map {
            buildString {
                repeat(image.width) {
                    val rgba = pixels.getInt()
                    append(if (rgba and 0xff == 0) '.' else keys[rgba] ?: KEYS.getOrNull(keys.size)?.also { keys[rgba] = it } ?: return null)
                }
            }
        }
        val palette = keys.entries.associate { (rgba, key) ->
            val hex = "%08x".format(rgba)
            key.toString() to "#" + if (hex.endsWith("ff")) hex.dropLast(2) else hex
        }
        return mapOf("palette" to palette, "rows" to rows)
    }

    private fun refuse(message: String): Nothing = throw McpRefusal("invalid_image", message)
}
