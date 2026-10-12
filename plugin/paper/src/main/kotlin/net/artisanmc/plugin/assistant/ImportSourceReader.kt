package net.artisanmc.plugin.assistant

import net.artisanmc.plugin.config.ImportSourceConfig
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.FileVisitResult
import java.nio.file.LinkOption
import java.nio.file.Path
import java.nio.file.SimpleFileVisitor
import java.nio.file.attribute.BasicFileAttributes
import java.util.logging.Logger
import kotlin.io.path.extension
import kotlin.io.path.invariantSeparatorsPathString

internal const val MAX_LISTED_ENTRIES = 5_000
internal const val MAX_FILES_PER_READ = 200
internal const val MAX_FILE_BYTES = 1024L * 1024L
internal const val MAX_TOTAL_BYTES = 8L * 1024L * 1024L

data class ImportFileMeta(val path: String, val size: Long)

data class ImportSourceListing(
    val id: String,
    val label: String,
    val files: List<ImportFileMeta>,
    val error: String? = null,
)

data class ImportSelection(val sourceId: String, val paths: List<String>)
data class ImportedTextFile(val sourceId: String, val path: String, val content: String)

sealed interface ImportReadResult {
    data class Success(val files: List<ImportedTextFile>) : ImportReadResult
    data class Failure(val error: String, val message: String? = null) : ImportReadResult
}

interface ImportSourceAccess {
    fun listAll(): List<ImportSourceListing>
    fun read(selections: List<ImportSelection>): ImportReadResult
}

class ImportSourceReader(
    private val serverRoot: Path,
    sources: List<ImportSourceConfig>,
    private val logger: Logger?,
) : ImportSourceAccess {
    private val sourcesById = sources.associateBy { it.id }

    override fun listAll(): List<ImportSourceListing> = sourcesById.values.mapNotNull(::listSource)

    private fun listSource(source: ImportSourceConfig): ImportSourceListing? {
        val root = try {
            safeConfiguredRoot(source)
        } catch (error: Exception) {
            logger?.warning("[assistant] import source '${source.id}' has an invalid path: ${error.logMessage()}")
            return null
        }
        if (!Files.isDirectory(root) || !Files.isReadable(root)) {
            logger?.warning("[assistant] import source '${source.id}' is missing or unreadable: $root")
            return null
        }

        val rootCanonical = try {
            root.toRealPath()
        } catch (error: Exception) {
            logger?.warning("[assistant] import source '${source.id}' cannot be resolved: ${error.logMessage()}")
            return null
        }
        val files = mutableListOf<ImportFileMeta>()
        var entryCount = 0
        var tooManyEntries = false
        try {
            Files.walkFileTree(rootCanonical, object : SimpleFileVisitor<Path>() {
                override fun preVisitDirectory(directory: Path, attributes: BasicFileAttributes): FileVisitResult =
                    if (directory != rootCanonical && directory.fileName.toString().startsWith('.')) {
                        FileVisitResult.SKIP_SUBTREE
                    } else {
                        FileVisitResult.CONTINUE
                    }

                override fun visitFile(path: Path, attributes: BasicFileAttributes): FileVisitResult {
                    val relative = rootCanonical.relativize(path)
                    if (
                        attributes.isRegularFile &&
                        relative.none { it.toString().startsWith('.') } &&
                        !hasSymbolicLinkSegment(rootCanonical, relative) &&
                        ".${path.extension.lowercase()}" in source.extensions
                    ) {
                        entryCount++
                        if (entryCount > MAX_LISTED_ENTRIES) {
                            tooManyEntries = true
                            return FileVisitResult.TERMINATE
                        }
                        files += ImportFileMeta(
                            path = relative.invariantSeparatorsPathString,
                            size = attributes.size(),
                        )
                    }
                    return FileVisitResult.CONTINUE
                }
            })
        } catch (error: Exception) {
            logger?.warning("[assistant] import source '${source.id}' is unreadable: ${error.logMessage()}")
            return null
        }
        if (tooManyEntries) {
            return ImportSourceListing(
                id = source.id,
                label = source.label,
                files = emptyList(),
                error = "too_many_entries",
            )
        }
        return ImportSourceListing(source.id, source.label, files.sortedBy { it.path })
    }

    override fun read(selections: List<ImportSelection>): ImportReadResult {
        if (selections.sumOf { it.paths.size } > MAX_FILES_PER_READ) {
            return ImportReadResult.Failure("too_many_files")
        }
        val files = mutableListOf<ImportedTextFile>()
        var totalBytes = 0L
        selections.forEach { selection ->
            val source = sourcesById[selection.sourceId]
                ?: return ImportReadResult.Failure("unknown_source", selection.sourceId)
            val rootCanonical = try {
                safeConfiguredRoot(source).toRealPath()
            } catch (_: UnsafeConfiguredRootException) {
                return ImportReadResult.Failure("invalid_path")
            } catch (_: Exception) {
                return ImportReadResult.Failure("not_found", source.id)
            }
            selection.paths.forEach { relative ->
                val relativePath = try {
                    Path.of(relative)
                } catch (_: Exception) {
                    return ImportReadResult.Failure("invalid_path")
                }
                if (
                    relative.isBlank() ||
                    relative.startsWith('/') ||
                    relative.startsWith('\\') ||
                    relativePath.isAbsolute ||
                    relativePath.any { it.toString().startsWith('.') }
                ) {
                    return ImportReadResult.Failure("invalid_path")
                }
                if (".${relativePath.extension.lowercase()}" !in source.extensions) {
                    return ImportReadResult.Failure("unsupported_file")
                }
                val target = rootCanonical.resolve(relativePath).normalize()
                if (hasSymbolicLinkSegment(rootCanonical, relativePath)) {
                    return ImportReadResult.Failure("invalid_path")
                }
                if (!Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS)) {
                    return ImportReadResult.Failure("not_found")
                }
                val targetCanonical = try {
                    target.toRealPath()
                } catch (_: Exception) {
                    return ImportReadResult.Failure("not_found")
                }
                if (!targetCanonical.startsWith(rootCanonical)) {
                    return ImportReadResult.Failure("invalid_path")
                }
                val size = try {
                    Files.size(targetCanonical)
                } catch (_: Exception) {
                    return ImportReadResult.Failure("read_error", relative)
                }
                if (size > MAX_FILE_BYTES) {
                    return ImportReadResult.Failure("file_too_large")
                }
                val bytes = try {
                    Files.newInputStream(targetCanonical).use { input ->
                        input.readNBytes((MAX_FILE_BYTES + 1).toInt())
                    }
                } catch (_: Exception) {
                    return ImportReadResult.Failure("read_error", relative)
                }
                if (bytes.size > MAX_FILE_BYTES) {
                    return ImportReadResult.Failure("file_too_large")
                }
                totalBytes += bytes.size
                if (totalBytes > MAX_TOTAL_BYTES) {
                    return ImportReadResult.Failure("too_large")
                }
                val content = try {
                    StandardCharsets.UTF_8.newDecoder()
                        .onMalformedInput(CodingErrorAction.REPORT)
                        .onUnmappableCharacter(CodingErrorAction.REPORT)
                        .decode(ByteBuffer.wrap(bytes))
                        .toString()
                } catch (_: CharacterCodingException) {
                    return ImportReadResult.Failure("invalid_utf8")
                }
                files += ImportedTextFile(
                    source.id,
                    relativePath.normalize().invariantSeparatorsPathString,
                    content,
                )
            }
        }
        return ImportReadResult.Success(files)
    }

    private fun configuredRoot(source: ImportSourceConfig): Path {
        val configured = Path.of(source.path)
        if (configured.isAbsolute) return configured.normalize()

        val normalizedServerRoot = serverRoot.toAbsolutePath().normalize()
        val resolved = normalizedServerRoot.resolve(configured).normalize()
        if (!resolved.startsWith(normalizedServerRoot)) {
            throw UnsafeConfiguredRootException("relative root escapes the server root: '${source.path}'")
        }
        return resolved
    }

    private fun safeConfiguredRoot(source: ImportSourceConfig): Path =
        configuredRoot(source).also { configuredRoot ->
            var current = configuredRoot.root
                ?: throw UnsafeConfiguredRootException("configured root is not absolute: '$configuredRoot'")
            configuredRoot.forEach { segment ->
                current = current.resolve(segment)
                if (Files.isSymbolicLink(current)) {
                    throw UnsafeConfiguredRootException("symbolic link in configured root path: '$current'")
                }
            }
        }

    private fun hasSymbolicLinkSegment(root: Path, relative: Path): Boolean {
        var current = root
        relative.forEach { segment ->
            current = current.resolve(segment)
            if (Files.isSymbolicLink(current)) return true
        }
        return false
    }
}

private class UnsafeConfiguredRootException(message: String) : IllegalArgumentException(message)

private fun Exception.logMessage(): String = message?.takeIf(String::isNotBlank) ?: javaClass.simpleName
