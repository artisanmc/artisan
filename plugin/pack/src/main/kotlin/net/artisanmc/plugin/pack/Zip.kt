package net.artisanmc.plugin.pack

import java.io.ByteArrayOutputStream
import java.util.zip.CRC32

/**
 * fflate 0.8's `zipSync(files, { level: 0, mtime })`, byte for byte: stored entries in the map's
 * order, version 2.0, no extra field, UTF-8 flag only for a non-ASCII name, the central
 * directory, then the end record. `java.util.zip.ZipOutputStream` writes other headers.
 */
internal object Zip {
    /** 2020-01-01 00:00:00 as a DOS date/time, the editor's fixed `ZIP_MTIME`. */
    private const val DOS_TIME = (40 shl 25) or (1 shl 21) or (1 shl 16)

    fun write(files: Map<String, ByteArray>): ByteArray {
        class Entry(val name: ByteArray, val utf8: Boolean, val data: ByteArray, val crc: Int, val offset: Int)

        val out = ByteArrayOutputStream()
        val entries = ArrayList<Entry>(files.size)
        for ((path, data) in files) {
            val name = path.toByteArray(Charsets.UTF_8)
            require(name.size <= 65535) { "zip entry name too long: $path" }
            val crc = CRC32().apply { update(data) }.value.toInt()
            val entry = Entry(name, name.size != path.length, data, crc, out.size())
            out.header(entry.name, entry.utf8, entry.data.size, entry.crc, central = null)
            out.write(data)
            entries += entry
        }
        val centralStart = out.size()
        for (e in entries) out.header(e.name, e.utf8, e.data.size, e.crc, central = e.offset)
        val centralSize = out.size() - centralStart
        out.int(0x06054b50)
        out.short(0)
        out.short(0)
        out.short(entries.size)
        out.short(entries.size)
        out.int(centralSize)
        out.int(centralStart)
        out.short(0)
        return out.toByteArray()
    }

    private fun ByteArrayOutputStream.header(name: ByteArray, utf8: Boolean, size: Int, crc: Int, central: Int?) {
        int(if (central != null) 0x02014b50 else 0x04034b50)
        if (central != null) short(20) // version made by: 2.0, MS-DOS
        short(20) // version needed
        short(if (utf8) 0x0800 else 0)
        short(0) // stored
        int(DOS_TIME)
        int(crc)
        int(size)
        int(size)
        short(name.size)
        short(0) // extra
        if (central != null) {
            short(0) // comment
            short(0) // disk
            short(0) // internal attributes
            int(0) // external attributes
            int(central)
        }
        write(name)
    }

    private fun ByteArrayOutputStream.short(v: Int) {
        write(v and 0xff)
        write((v ushr 8) and 0xff)
    }

    private fun ByteArrayOutputStream.int(v: Int) {
        short(v and 0xffff)
        short(v ushr 16)
    }
}
