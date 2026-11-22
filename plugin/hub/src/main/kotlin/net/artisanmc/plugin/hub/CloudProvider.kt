package net.artisanmc.plugin.hub

import okhttp3.OkHttpClient
import java.time.Duration

/**
 * The `artisan` provider (ADR `editor-assistant`, decision 13): the models artisanmc.net offers,
 * paid from the credits of the site account the network is linked to (ADR
 * `site-account-and-module-updates`). Every editor user of the network spends that one balance.
 *
 * The site is a relay that speaks each model's own protocol: a call goes, with the link's token, to
 * [SiteAccount.aiEndpoint] as an Anthropic or an OpenAI-compatible request (the protocol the site's
 * catalogue gives for [AiConfig.model]), and the site sends it on with its own key. So this provider
 * is one of the other two, pointed at the site: nothing of the vendor's key is ever here.
 */
class CloudProvider(
    private val config: AiConfig,
    private val site: SiteAccount,
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(Duration.ofSeconds(10))
        .readTimeout(Duration.ofMinutes(10))
        .build(),
) : AiProvider {
    private val relay = AiRelay(site.aiEndpoint, token = { site.link()?.token }, refused = site::refused)
    /** Pointed at the site, so neither sends what only the vendor's own API reads. */
    private val relayed = config.copy(apiKey = "", baseUrl = site.baseUrl)
    private val anthropic by lazy { AnthropicProvider(relayed.copy(provider = "anthropic"), client, relay) }
    private val openai by lazy { OpenAiProvider(relayed.copy(provider = "openai"), client, relay) }

    override val model: String get() = config.model

    override val historyKey: String get() = "${AiConfig.ARTISAN}|${config.model}"

    /** From the catalogue read last (never a call to the site here: the status route reads it); text alone before. */
    override val attachments: Set<AiAttachment.Kind>
        get() = site.knownAi()?.model(config.model)?.attachments ?: setOf(AiAttachment.Kind.TEXT)

    override fun conversation(system: String, tools: List<McpTools.Tool>): AiConversation = protocol().conversation(system, tools)

    override fun resume(system: String, tools: List<McpTools.Tool>, history: String): AiConversation? = protocol().resume(system, tools, history)

    /** The provider that speaks the model's protocol, from the site's catalogue (asked on the assistant's own thread). */
    private fun protocol(): AiProvider {
        val catalogue = try {
            site.ai()
        } catch (e: SiteFailure) {
            throw if (e.code == "site_not_linked") AiFailure("ai_not_linked", "The network is not linked to an artisanmc.net account")
            else AiFailure("ai_unreachable", "artisanmc.net could not be reached: ${e.message}", e)
        }
        val entry = catalogue.model(config.model) ?: throw AiFailure("ai_cloud_model", "artisanmc.net does not offer the model ${config.model}")
        return if (entry.protocol == "anthropic") anthropic else openai
    }
}
