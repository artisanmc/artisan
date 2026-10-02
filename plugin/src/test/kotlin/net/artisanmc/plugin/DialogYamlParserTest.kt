package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.model.DialogYaml
import kotlin.test.*

class DialogYamlParserTest {
    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()

    @Test fun `parses minimal dialog`() {
        val d = mapper.readValue("""
            schema: dialog/v1
            id: d_simple
            title: Hello
            buttons:
              - id: btn_ok
                label: OK
                actions: close_dialog
        """.trimIndent(), DialogYaml::class.java)
        assertEquals("d_simple", d.id)
        assertEquals("Hello", d.title?.forLang("en", "en"))
        assertTrue(d.canCloseWithEscape)
        assertEquals(1, d.buttons.size)
        assertEquals("btn_ok", d.buttons[0].id)
        assertEquals("OK", d.buttons[0].label?.forLang("en", "en"))
        // Button actions are an Action DSL string since Phase 2 (ADR action-dsl).
        assertEquals("close_dialog", d.buttons[0].actions)
    }

    @Test fun `parses can_close_with_escape false`() {
        val d = mapper.readValue("""
            id: d_lock
            title: Locked
            can_close_with_escape: false
            buttons:
              - id: btn_ok
                label: OK
        """.trimIndent(), DialogYaml::class.java)
        assertFalse(d.canCloseWithEscape)
    }

    @Test fun `parses body text and item`() {
        val d = mapper.readValue("""
            id: d_body
            title: T
            body:
              - type: text
                text: "Hello world"
              - type: item
                material: DIAMOND
                count: 5
            buttons:
              - id: btn_ok
                label: OK
        """.trimIndent(), DialogYaml::class.java)
        assertEquals(2, d.body.size)
        assertEquals("text", d.body[0].type)
        assertEquals("Hello world", d.body[0].text?.forLang("en", "en"))
        assertEquals("item", d.body[1].type)
        assertEquals("DIAMOND", d.body[1].material)
        assertEquals(5, d.body[1].count)
    }

    @Test fun `parses number_range input`() {
        val d = mapper.readValue("""
            id: d_range
            title: T
            inputs:
              - id: qty
                type: number_range
                label: Quantity
                min: 1
                max: 64
                default: "1"
            buttons:
              - id: btn_ok
                label: OK
        """.trimIndent(), DialogYaml::class.java)
        val input = d.inputs[0]
        assertEquals("qty", input.id)
        assertEquals("number_range", input.type)
        assertEquals(1.0, input.min)
        assertEquals(64.0, input.max)
        assertEquals("1", input.default)
    }

    @Test fun `parses bool input`() {
        val d = mapper.readValue("""
            id: d_bool
            title: T
            inputs:
              - id: gift
                type: bool
                label: "Gift?"
                default: "false"
            buttons:
              - id: btn_ok
                label: OK
        """.trimIndent(), DialogYaml::class.java)
        assertEquals("bool", d.inputs[0].type)
        assertEquals("false", d.inputs[0].default)
    }

    @Test fun `parses text input with max_length`() {
        val d = mapper.readValue("""
            id: d_text
            title: T
            inputs:
              - id: note
                type: text
                label: Note
                default: ""
                max_length: 64
            buttons:
              - id: btn_ok
                label: OK
        """.trimIndent(), DialogYaml::class.java)
        assertEquals("text", d.inputs[0].type)
        assertEquals(64, d.inputs[0].maxLength)
        assertEquals("", d.inputs[0].default)
    }

    @Test fun `parses single_option input with options`() {
        val d = mapper.readValue("""
            id: d_option
            title: T
            inputs:
              - id: tier
                type: single_option
                label: Tier
                default: basic
                options:
                  - value: basic
                    label: Basic
                  - value: premium
                    label: Premium
            buttons:
              - id: btn_ok
                label: OK
        """.trimIndent(), DialogYaml::class.java)
        val input = d.inputs[0]
        assertEquals("single_option", input.type)
        assertEquals(2, input.options.size)
        assertEquals("basic", input.options[0].value)
        assertEquals("Basic", input.options[0].label?.forLang("en", "en"))
        assertEquals("premium", input.options[1].value)
        assertEquals("basic", input.default)
    }

    @Test fun `parses button with requirements and fallback`() {
        val d = mapper.readValue("""
            id: d_req
            title: T
            buttons:
              - id: btn_buy
                label: Buy
                requirements:
                  - type: has_money
                    amount: 100
                actions: take_money 100
                fallback:
                  - type: send_message
                    text: "Not enough"
        """.trimIndent(), DialogYaml::class.java)
        val btn = d.buttons[0]
        assertEquals(1, btn.requirements.size)
        assertEquals("has_money", btn.requirements[0]["type"])
        assertEquals("take_money 100", btn.actions)
        assertEquals(1, (btn.fallback as List<*>).size)
    }
}
