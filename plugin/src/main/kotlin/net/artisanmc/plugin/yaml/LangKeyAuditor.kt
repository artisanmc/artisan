package net.artisanmc.plugin.yaml

/**
 * Text-level scan for translation-key references inside project YAML files.
 *
 * Two shapes exist on the wire: `{i18n:<key>}` strings (items, actions,
 * dialogs) and title-layer `key: <key>` fields. A plain-text regex scan
 * over-collects (any `key:` field matches) — acceptable: over-collection only
 * suppresses warnings, never fabricates one.
 */
object LangKeyAuditor {

    private val I18N_REF = Regex("""\{i18n:([^}]+)}""")
    private val KEY_FIELD = Regex("""(?m)^\s*key:\s*"?([^"\s]+)"?\s*$""")

    fun referencedKeys(yamlTexts: List<String>): Set<String> =
        yamlTexts.flatMapTo(mutableSetOf()) { text ->
            I18N_REF.findAll(text).map { it.groupValues[1] }.toList() +
                KEY_FIELD.findAll(text).map { it.groupValues[1] }.toList()
        }
}
