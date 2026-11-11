package net.artisanmc.plugin.engine

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.core.util.DefaultIndenter
import com.fasterxml.jackson.core.util.DefaultPrettyPrinter
import com.fasterxml.jackson.core.util.Separators
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File

/**
 * `testdata/core-actions.json` is the core vocabulary as the editor reads it: one entry per
 * [CoreActions] schema, in the `declared_actions` wire shape of Presence (name, args,
 * primary) plus the legacy `i18n_slots` the addresser uses ([assignI18nAddresses]). The
 * editor imports that file as its table of core actions, so this test keeps it equal to
 * the Kotlin declarations: a core action changes here, in one place, and the file follows.
 *
 * Regenerate with `ARTISAN_WRITE_VECTORS=1 ./gradlew :artisan-core:test --tests '*CoreActionsVectorTest*'`.
 */
class CoreActionsVectorTest {
    private val mapper = ObjectMapper()

    /** `{"name": …}` with two-space indentation, as the hand-written vectors are formatted. */
    private val printer = DefaultPrettyPrinter()
        .withSeparators(Separators.createDefaultInstance().withObjectFieldValueSpacing(Separators.Spacing.AFTER))
        .withArrayIndenter(DefaultIndenter.SYSTEM_LINEFEED_INSTANCE)

    private fun vectorFile(): File {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            val testdata = File(dir, "testdata")
            if (testdata.isDirectory) return File(testdata, "core-actions.json")
            dir = dir.parentFile
        }
        error("testdata/ not found from ${System.getProperty("user.dir")}")
    }

    private fun generated(): JsonNode {
        val actions = CoreActions.all.map { schema ->
            val entry = linkedMapOf<String, Any?>(
                "name" to schema.name,
                "args" to schema.args.map { it.toWire() },
                "primary" to schema.primary,
            )
            if (schema.i18nSlots.isNotEmpty()) entry["i18n_slots"] = schema.i18nSlots
            entry
        }
        return mapper.valueToTree(
            linkedMapOf(
                "note" to "Artisan's own action vocabulary, generated from plugin/core CoreActions.kt " +
                    "(CoreActionsVectorTest keeps it equal; regenerate with ARTISAN_WRITE_VECTORS=1). " +
                    "Entries are in the declared_actions wire shape of Presence (name, args, primary); " +
                    "i18n_slots names the legacy slot of a text argument for the positional addressing of " +
                    "the Action DSL (testdata/i18n-address-conformance.json). The editor imports this file " +
                    "as its table of core actions (lib/actions/coreActions.ts): forms, i18n sites and the " +
                    "step picker read it, never a hand-written copy.",
                "actions" to actions,
            ),
        )
    }

    @Test fun `the shared vector is the core vocabulary`() {
        val file = vectorFile()
        val expected = generated()
        if (System.getenv("ARTISAN_WRITE_VECTORS") == "1") {
            file.writeText(mapper.writer(printer).writeValueAsString(expected) + "\n")
        }
        assertEquals(
            expected,
            mapper.readTree(file),
            "testdata/core-actions.json differs from CoreActions: regenerate it with ARTISAN_WRITE_VECTORS=1",
        )
    }
}
