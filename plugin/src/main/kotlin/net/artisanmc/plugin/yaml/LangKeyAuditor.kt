package net.artisanmc.plugin.yaml

/**
 * Text-level scan for translation-key references inside project YAML files.
 *
 * Two shapes exist on the wire: `{i18n:<key>}` strings (items, actions,
 * dialogs) and `key: <key>` fields (title layers, both block-style lines and
 * flow-style inline maps like `value: { key: menus.shop.title }`). A plain-text
 * regex scan over-collects (any `key:` field matches, quoted or bare) —
 * acceptable: over-collection only suppresses warnings, never fabricates one.
 */
object LangKeyAuditor {

    private val I18N_REF = Regex("""\{i18n:([^}]+)}""")

    // `key:` not preceded by an identifier char (excludes `background_key:` etc.),
    // followed by a double-quoted, single-quoted, or bare value. Not line-anchored
    // so it also matches flow-style inline maps.
    private val KEY_FIELD = Regex("""(?<![\w])key:\s*(?:"([^"]*)"|'([^']*)'|([^\s,}]+))""")

    fun referencedKeys(yamlTexts: List<String>): Set<String> =
        yamlTexts.flatMapTo(mutableSetOf()) { text ->
            I18N_REF.findAll(text).map { it.groupValues[1] }.toList() +
                KEY_FIELD.findAll(text).map { m ->
                    m.groupValues[1].ifEmpty { m.groupValues[2] }.ifEmpty { m.groupValues[3] }
                }.toList()
        }
}
