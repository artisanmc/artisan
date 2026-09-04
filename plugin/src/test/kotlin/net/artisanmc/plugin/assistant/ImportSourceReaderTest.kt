package net.artisanmc.plugin.assistant

import net.artisanmc.plugin.config.ImportSourceConfig
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import java.util.logging.Handler
import java.util.logging.LogRecord
import java.util.logging.Logger
import kotlin.test.Test
import kotlin.test.assertEquals

class ImportSourceReaderTest {
    @TempDir
    lateinit var root: Path

    private fun source(
        id: String = "zmenu",
        path: String = "plugins/zMenu/menus",
        extensions: Set<String> = setOf(".yml", ".yaml"),
    ) = ImportSourceConfig(id, "zMenu", path, extensions)

    private fun reader(vararg sources: ImportSourceConfig) =
        ImportSourceReader(serverRoot = root, sources = sources.toList(), logger = null)

    private fun capturingLogger(warnings: MutableList<String>) =
        Logger.getLogger("artisan-import-${System.nanoTime()}").apply {
            useParentHandlers = false
            addHandler(object : Handler() {
                override fun publish(record: LogRecord) {
                    warnings += record.message
                }
                override fun flush() = Unit
                override fun close() = Unit
            })
        }

    @Test
    fun `lists allowed files recursively with normalized relative paths`() {
        Files.createDirectories(root.resolve("plugins/zMenu/menus/categories"))
        Files.writeString(root.resolve("plugins/zMenu/menus/shop.yml"), "name: Shop")
        Files.writeString(root.resolve("plugins/zMenu/menus/categories/blocks.yaml"), "name: Blocks")
        Files.writeString(root.resolve("plugins/zMenu/menus/secret.txt"), "ignored")

        val listed = reader(source()).listAll()

        assertEquals(
            listOf(
                ImportFileMeta("categories/blocks.yaml", "name: Blocks".toByteArray().size.toLong()),
                ImportFileMeta("shop.yml", "name: Shop".toByteArray().size.toLong()),
            ),
            listed.single().files,
        )
    }

    @Test
    fun `accepts an explicitly configured absolute root`() {
        val absoluteRoot = Files.createDirectories(root.resolve("absolute"))
        Files.writeString(absoluteRoot.resolve("menu.yml"), "safe")

        val listing = reader(source(path = absoluteRoot.toString())).listAll().single()

        assertEquals(listOf("menu.yml"), listing.files.map { it.path })
    }

    @Test
    fun `rejects a relative configured root that escapes the server root`() {
        val serverRoot = Files.createDirectories(root.resolve("server"))
        val outsideRoot = Files.createDirectories(root.resolve("outside"))
        Files.writeString(outsideRoot.resolve("menu.yml"), "secret")
        val warnings = mutableListOf<String>()
        val access = ImportSourceReader(
            serverRoot = serverRoot,
            sources = listOf(source(path = "../outside")),
            logger = capturingLogger(warnings),
        )

        assertEquals(emptyList(), access.listAll())
        assertEquals(true, warnings.single().contains("relative root escapes the server root"))
        assertEquals(false, warnings.single().contains("null"))
        assertEquals(
            ImportReadResult.Failure("invalid_path"),
            access.read(listOf(ImportSelection("zmenu", listOf("menu.yml")))),
        )
    }

    @Test
    fun `reads selected UTF-8 files with source and relative path`() {
        Files.createDirectories(root.resolve("allowed/categories"))
        Files.writeString(root.resolve("allowed/shop.yml"), "name: Shop")
        Files.writeString(root.resolve("allowed/categories/blocks.yaml"), "name: Blocks")

        val result = reader(source(path = "allowed")).read(
            listOf(ImportSelection("zmenu", listOf("shop.yml", "categories/blocks.yaml"))),
        )

        assertEquals(
            ImportReadResult.Success(listOf(
                ImportedTextFile("zmenu", "shop.yml", "name: Shop"),
                ImportedTextFile("zmenu", "categories/blocks.yaml", "name: Blocks"),
            )),
            result,
        )
    }

    @Test
    fun `one invalid selection rejects the whole read`() {
        Files.createDirectories(root.resolve("allowed"))
        Files.writeString(root.resolve("allowed/ok.yml"), "safe")
        Files.createDirectories(root.resolve("allowed-other"))
        Files.writeString(root.resolve("allowed-other/secret.yml"), "secret")

        val result = reader(source(path = "allowed")).read(
            listOf(ImportSelection("zmenu", listOf("ok.yml", "../allowed-other/secret.yml"))),
        )

        assertEquals(ImportReadResult.Failure("invalid_path"), result)
    }

    @Test
    fun `rejects blank absolute and hidden relative paths`() {
        Files.createDirectories(root.resolve("allowed/.private"))
        Files.writeString(root.resolve("allowed/.private/menu.yml"), "hidden")
        val outside = Files.writeString(root.resolve("outside.yml"), "outside")
        val access = reader(source(path = "allowed"))

        listOf("", outside.toString(), ".private/menu.yml").forEach { unsafePath ->
            assertEquals(
                ImportReadResult.Failure("invalid_path"),
                access.read(listOf(ImportSelection("zmenu", listOf(unsafePath)))),
                unsafePath,
            )
        }
    }

    @Test
    fun `rejects files outside the configured extension allowlist`() {
        Files.createDirectories(root.resolve("allowed"))
        Files.writeString(root.resolve("allowed/secret.txt"), "secret")

        val result = reader(source(path = "allowed")).read(
            listOf(ImportSelection("zmenu", listOf("secret.txt"))),
        )

        assertEquals(ImportReadResult.Failure("unsupported_file"), result)
    }

    @Test
    fun `rejects missing files and directory inputs`() {
        Files.createDirectories(root.resolve("allowed/folder.yml"))
        val access = reader(source(path = "allowed"))

        listOf("missing.yml", "folder.yml").forEach { path ->
            assertEquals(
                ImportReadResult.Failure("not_found"),
                access.read(listOf(ImportSelection("zmenu", listOf(path)))),
                path,
            )
        }
    }

    @Test
    fun `rejects symbolic link files and intermediate directories`() {
        val allowed = Files.createDirectories(root.resolve("allowed"))
        val outside = Files.createDirectories(root.resolve("outside"))
        val secret = Files.writeString(outside.resolve("secret.yml"), "secret")
        try {
            Files.createSymbolicLink(allowed.resolve("linked.yml"), secret)
            Files.createSymbolicLink(allowed.resolve("linked-dir"), outside)
        } catch (error: Exception) {
            assumeTrue(false, "test filesystem cannot create symlinks: ${error.message}")
        }
        val access = reader(source(path = "allowed"))

        assertEquals(emptyList(), access.listAll().single().files)
        listOf("linked.yml", "linked-dir/secret.yml").forEach { path ->
            assertEquals(
                ImportReadResult.Failure("invalid_path"),
                access.read(listOf(ImportSelection("zmenu", listOf(path)))),
                path,
            )
        }
    }

    @Test
    fun `rejects a configured root that is a symbolic link`() {
        val realRoot = Files.createDirectories(root.resolve("real-root"))
        Files.writeString(realRoot.resolve("menu.yml"), "secret")
        val linkedRoot = root.resolve("linked-root")
        try {
            Files.createSymbolicLink(linkedRoot, realRoot)
        } catch (error: Exception) {
            assumeTrue(false, "test filesystem cannot create symlinks: ${error.message}")
        }
        val warnings = mutableListOf<String>()
        val access = ImportSourceReader(
            serverRoot = root,
            sources = listOf(source(path = "linked-root")),
            logger = capturingLogger(warnings),
        )

        assertEquals(emptyList(), access.listAll())
        assertEquals(true, warnings.single().contains("symbolic link in configured root path"))
        assertEquals(false, warnings.single().contains("null"))
        assertEquals(
            ImportReadResult.Failure("invalid_path"),
            access.read(listOf(ImportSelection("zmenu", listOf("menu.yml")))),
        )
    }

    @Test
    fun `rejects a configured root below a symbolic link parent`() {
        val realParent = Files.createDirectories(root.resolve("real-parent/menus"))
        Files.writeString(realParent.resolve("menu.yml"), "secret")
        val linkedParent = root.resolve("linked-parent")
        try {
            Files.createSymbolicLink(linkedParent, realParent.parent)
        } catch (error: Exception) {
            assumeTrue(false, "test filesystem cannot create symlinks: ${error.message}")
        }
        val access = reader(source(path = "linked-parent/menus"))

        assertEquals(emptyList(), access.listAll())
        assertEquals(
            ImportReadResult.Failure("invalid_path"),
            access.read(listOf(ImportSelection("zmenu", listOf("menu.yml")))),
        )
    }

    @Test
    fun `listing excludes files below hidden path segments`() {
        Files.createDirectories(root.resolve("allowed/.private"))
        Files.createDirectories(root.resolve("allowed/visible"))
        Files.writeString(root.resolve("allowed/.private/secret.yml"), "secret")
        Files.writeString(root.resolve("allowed/.hidden.yml"), "secret")
        Files.writeString(root.resolve("allowed/visible/menu.yml"), "safe")

        val listing = reader(source(path = "allowed")).listAll().single()

        assertEquals(listOf("visible/menu.yml"), listing.files.map { it.path })
    }

    @Test
    fun `rejects malformed UTF-8 without returning partial content`() {
        Files.createDirectories(root.resolve("allowed"))
        Files.writeString(root.resolve("allowed/ok.yml"), "safe")
        Files.write(root.resolve("allowed/broken.yml"), byteArrayOf(0xC3.toByte(), 0x28))

        val result = reader(source(path = "allowed")).read(
            listOf(ImportSelection("zmenu", listOf("ok.yml", "broken.yml"))),
        )

        assertEquals(ImportReadResult.Failure("invalid_utf8"), result)
    }

    @Test
    fun `rejects more than 200 requested files before reading`() {
        Files.createDirectories(root.resolve("allowed"))
        val paths = (1..201).map { "menu-$it.yml" }

        val result = reader(source(path = "allowed")).read(
            listOf(ImportSelection("zmenu", paths)),
        )

        assertEquals(ImportReadResult.Failure("too_many_files"), result)
    }

    @Test
    fun `rejects one file over one MiB`() {
        Files.createDirectories(root.resolve("allowed"))
        Files.write(root.resolve("allowed/large.yml"), ByteArray((MAX_FILE_BYTES + 1).toInt()))

        val result = reader(source(path = "allowed")).read(
            listOf(ImportSelection("zmenu", listOf("large.yml"))),
        )

        assertEquals(ImportReadResult.Failure("file_too_large"), result)
    }

    @Test
    fun `rejects a batch over eight MiB`() {
        val allowed = Files.createDirectories(root.resolve("allowed"))
        val paths = (1..9).map { index ->
            "menu-$index.yml".also { Files.write(allowed.resolve(it), ByteArray(MAX_FILE_BYTES.toInt())) }
        }

        val result = reader(source(path = "allowed")).read(
            listOf(ImportSelection("zmenu", paths)),
        )

        assertEquals(ImportReadResult.Failure("too_large"), result)
    }

    @Test
    fun `listing over five thousand entries returns an error without partial files`() {
        val allowed = Files.createDirectories(root.resolve("allowed"))
        repeat(MAX_LISTED_ENTRIES + 1) { index ->
            Files.createFile(allowed.resolve("menu-$index.yml"))
        }

        val listing = reader(source(path = "allowed")).listAll().single()

        assertEquals("too_many_entries", listing.error)
        assertEquals(emptyList(), listing.files)
    }

    @Test
    fun `listing limit counts only files matching the source allowlist`() {
        val allowed = Files.createDirectories(root.resolve("allowed"))
        repeat(MAX_LISTED_ENTRIES + 1) { index ->
            Files.createFile(allowed.resolve("ignored-$index.txt"))
        }
        Files.writeString(allowed.resolve("menu.yml"), "safe")

        val listing = reader(source(path = "allowed")).listAll().single()

        assertEquals(null, listing.error)
        assertEquals(listOf("menu.yml"), listing.files.map { it.path })
    }

    @Test
    fun `listing prunes a large hidden directory`() {
        val allowed = Files.createDirectories(root.resolve("allowed"))
        val hidden = Files.createDirectories(allowed.resolve(".cache"))
        repeat(MAX_LISTED_ENTRIES + 1) { index ->
            Files.createFile(hidden.resolve("hidden-$index.yml"))
        }
        Files.writeString(allowed.resolve("menu.yml"), "safe")

        val listing = reader(source(path = "allowed")).listAll().single()

        assertEquals(null, listing.error)
        assertEquals(listOf("menu.yml"), listing.files.map { it.path })
    }

    @Test
    fun `missing and unreadable roots are omitted and logged`() {
        val valid = Files.createDirectories(root.resolve("valid"))
        Files.writeString(valid.resolve("menu.yml"), "safe")
        Files.writeString(root.resolve("not-a-directory"), "file")
        val warnings = mutableListOf<String>()
        val access = ImportSourceReader(
            serverRoot = root,
            sources = listOf(
                source(id = "valid", path = "valid"),
                source(id = "missing", path = "missing"),
                source(id = "not-directory", path = "not-a-directory"),
            ),
            logger = capturingLogger(warnings),
        )

        val listings = access.listAll()

        assertEquals(listOf("valid"), listings.map { it.id })
        assertEquals(2, warnings.size)
        assertEquals(true, warnings.any { it.contains("missing") })
        assertEquals(true, warnings.any { it.contains("not-directory") })
    }

    @Test
    fun `invalid configured root is omitted and logged`() {
        val warnings = mutableListOf<String>()
        val access = ImportSourceReader(
            serverRoot = root,
            sources = listOf(source(id = "invalid", path = "bad\u0000path")),
            logger = capturingLogger(warnings),
        )

        assertEquals(emptyList(), access.listAll())
        assertEquals(1, warnings.size)
        assertEquals(true, warnings.single().contains("invalid"))
    }

    @Test
    fun `unreadable configured root is omitted and logged when permissions are supported`() {
        val unreadable = Files.createDirectories(root.resolve("unreadable"))
        val permissionsChanged = unreadable.toFile().setReadable(false, false)
        try {
            assumeTrue(permissionsChanged && !Files.isReadable(unreadable), "filesystem keeps the root readable")
            val warnings = mutableListOf<String>()
            val access = ImportSourceReader(
                serverRoot = root,
                sources = listOf(source(id = "unreadable", path = "unreadable")),
                logger = capturingLogger(warnings),
            )

            assertEquals(emptyList(), access.listAll())
            assertEquals(true, warnings.single().contains("unreadable"))
        } finally {
            unreadable.toFile().setReadable(true, false)
        }
    }

    @Test
    fun `unknown sources are rejected`() {
        val result = reader(source(path = "allowed")).read(
            listOf(ImportSelection("unknown", listOf("menu.yml"))),
        )

        assertEquals("unknown_source", (result as ImportReadResult.Failure).error)
    }
}
