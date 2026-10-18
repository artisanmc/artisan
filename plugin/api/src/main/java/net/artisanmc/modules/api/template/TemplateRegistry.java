package net.artisanmc.modules.api.template;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import net.artisanmc.modules.api.OwnedRegistry;
import net.artisanmc.modules.api.annotations.Beta;
import net.artisanmc.modules.api.annotations.Internal;
import org.jetbrains.annotations.Nullable;

/**
 * The templates the modules ship ({@code api.templates}): example content a module offers to
 * copy into any project, keyed by the module that registered it from its {@code onEnable} and
 * removed with it. Reported at Presence on the module's {@code installed_modules} entry
 * ({@code templates}); the hub fetches the files on demand ({@code template_fetch}).
 *
 * <pre>{@code
 * api.getTemplates().register(TemplateDeclaration
 *     .fromResources(getClass().getClassLoader(), "artisan-templates/daily", "daily", 1,
 *         List.of("manifest.yaml", "quest_groups/daily.yaml", "menus/quests_daily.yaml"))
 *     .title("Daily quests")
 *     .seed("quests")
 *     .build());
 * }</pre>
 */
@Beta
public final class TemplateRegistry implements OwnedRegistry {
    /** module id → template id → declaration. */
    private final Map<String, Map<String, TemplateDeclaration>> templates = new LinkedHashMap<>();

    /** Owner captured for registrations happening right now; see {@link OwnedRegistry#bindOwner}. */
    private volatile @Nullable String currentOwner;

    @Internal
    @Override
    public void bindOwner(@Nullable String moduleId) {
        currentOwner = moduleId;
    }

    /**
     * Registers {@code decl} as a template of the module whose {@code onEnable} is running.
     *
     * @throws IllegalStateException outside a module's {@code onEnable}, or when that module
     *     already registered a template with this id.
     */
    @Beta
    public synchronized void register(TemplateDeclaration decl) {
        String owner = currentOwner;
        if (owner == null) throw new IllegalStateException("a template is registered from a module's onEnable");
        Map<String, TemplateDeclaration> own = templates.computeIfAbsent(owner, k -> new LinkedHashMap<>());
        if (own.containsKey(decl.getId())) {
            throw new IllegalStateException("module '" + owner + "' already registered the template '" + decl.getId() + "'");
        }
        own.put(decl.getId(), decl);
    }

    @Internal
    @Override
    public synchronized void unregisterOwnedBy(String moduleId) {
        templates.remove(moduleId);
    }

    /** The template {@code templateId} of {@code moduleId}, or null. */
    @Beta
    public synchronized @Nullable TemplateDeclaration find(String moduleId, String templateId) {
        Map<String, TemplateDeclaration> own = templates.get(moduleId);
        return own != null ? own.get(templateId) : null;
    }

    /** The templates of {@code moduleId}, in registration order. */
    @Beta
    public synchronized List<TemplateDeclaration> of(String moduleId) {
        Map<String, TemplateDeclaration> own = templates.get(moduleId);
        return own != null ? List.copyOf(own.values()) : List.of();
    }

    /** Every template by module id, in registration order. */
    @Beta
    public synchronized Map<String, List<TemplateDeclaration>> registered() {
        Map<String, List<TemplateDeclaration>> out = new LinkedHashMap<>();
        templates.forEach((module, own) -> out.put(module, new ArrayList<>(own.values())));
        return out;
    }
}
