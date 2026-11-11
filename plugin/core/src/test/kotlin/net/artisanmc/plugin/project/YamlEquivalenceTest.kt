package net.artisanmc.plugin.project

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class YamlEquivalenceTest {
    @Test
    fun `style, quotes, key order, comments and CRLF do not count`() {
        assertTrue(YamlEquivalence.sameValue("a.yml", "t: { en: \"A\", fr: 'B' } # c\r\n", "t:\n  fr: B\n  en: A\n"))
        assertTrue(YamlEquivalence.sameValue("a.yaml", "a: [1, 2]", "a:\n  - 1\n  - 2\n"))
    }

    @Test
    fun `a changed value, a non-YAML file or unreadable YAML is never the same`() {
        assertFalse(YamlEquivalence.sameValue("a.yml", "a: [1, 2]", "a: [2, 1]"))
        assertFalse(YamlEquivalence.sameValue("a.yml", "a: 1", "a: '1'"))
        assertFalse(YamlEquivalence.sameValue("a.txt", "a: 1\r\n", "a: 1\n"))
        assertFalse(YamlEquivalence.sameValue("a.yml", "a: [", "a: ]"))
    }
}
