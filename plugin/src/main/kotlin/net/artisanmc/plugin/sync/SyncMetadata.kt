package net.artisanmc.plugin.sync

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import java.io.File
import java.time.Instant

@JsonIgnoreProperties(ignoreUnknown = true)
data class SyncMetadata(
    @JsonProperty("synced_hash")  val syncedHash: String  = "",
    @JsonProperty("synced_at")    val syncedAt: String    = "",
    @JsonProperty("backend_hash") val backendHash: String = "",
) {
    companion object {
        private const val FILENAME = ".artisan-sync.yaml"
        private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()

        fun read(projectDir: File): SyncMetadata {
            val file = File(projectDir, FILENAME)
            if (!file.exists()) return SyncMetadata()
            return runCatching { mapper.readValue(file, SyncMetadata::class.java) }
                .getOrDefault(SyncMetadata())
        }

        fun write(projectDir: File, meta: SyncMetadata) {
            mapper.writeValue(File(projectDir, FILENAME), meta)
        }

        fun recordSync(projectDir: File, syncedHash: String, backendHash: String) {
            write(projectDir, SyncMetadata(
                syncedHash  = syncedHash,
                syncedAt    = Instant.now().toString(),
                backendHash = backendHash,
            ))
        }
    }
}
