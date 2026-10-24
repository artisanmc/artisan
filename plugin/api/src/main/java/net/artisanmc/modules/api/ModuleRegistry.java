package net.artisanmc.modules.api;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import net.artisanmc.modules.api.annotations.Internal;
import net.artisanmc.modules.api.annotations.Stable;
import org.jetbrains.annotations.Nullable;

/**
 * Runtime registry of {@link ArtisanModule}s ({@code api.modules}). {@link #register} calls
 * the module's {@code onEnable} and signals the change so the plugin can tell the editor;
 * {@link #unregister} undoes it. Must be {@link #bind bound} to an {@link ArtisanAPI}
 * before {@link #register} is called.
 */
@Stable
public final class ModuleRegistry {
    private final CopyOnWriteArrayList<ArtisanModule> active = new CopyOnWriteArrayList<>();
    private volatile @Nullable ArtisanAPI api;
    private volatile @Nullable Runnable onChange;

    /**
     * Binds this registry to the live {@link ArtisanAPI} and the callback that fires
     * whenever the active module list changes. Called once at plugin enable.
     */
    @Internal
    public void bind(ArtisanAPI api, Runnable onChange) {
        this.api = api;
        this.onChange = onChange;
    }

    /**
     * Registers {@code module} and calls its {@code onEnable}. Throws
     * {@link IllegalStateException} if not yet bound, {@link DuplicateModuleException}
     * if a module with the same id is already registered.
     */
    @Stable
    public void register(ArtisanModule module) {
        ArtisanAPI boundApi = api;
        if (boundApi == null) throw new IllegalStateException("ModuleRegistry must be bound before registering modules");
        synchronized (active) {
            if (has(module.getId())) throw new DuplicateModuleException(module.getId());
            active.add(module);
        }
        setOwner(boundApi, module.getId());
        try {
            module.onEnable(boundApi);
        } finally {
            setOwner(boundApi, null);
        }
        signalChange();
    }

    /**
     * Unregisters the module {@code id}: calls its {@code onDisable}, then removes the data
     * sources, commands, models, screens, actions, document kinds and editor bundle it registered from its {@code onEnable}.
     * Returns false if no such module is registered. Artisan does it on its own when the
     * plugin that loaded the module disables.
     */
    @Stable
    public boolean unregister(String id) {
        ArtisanModule module;
        synchronized (active) {
            module = active.stream().filter(m -> m.getId().equals(id)).findFirst().orElse(null);
            if (module == null) return false;
            active.remove(module);
        }
        try {
            module.onDisable();
        } finally {
            ArtisanAPI boundApi = api;
            if (boundApi != null) {
                for (OwnedRegistry registry : owned(boundApi)) registry.unregisterOwnedBy(id);
            }
            signalChange();
        }
        return true;
    }

    /**
     * Unregisters everything a disabling plugin left behind: its modules (see
     * {@link #unregister}), then the data sources and commands whose callback was loaded
     * by {@code loader}. Returns the failures of modules' {@code onDisable}, for the caller to log.
     */
    @Internal
    public List<Exception> unregisterLoadedBy(ClassLoader loader) {
        List<Exception> failures = new ArrayList<>();
        for (ArtisanModule module : active()) {
            if (module.getClass().getClassLoader() != loader) continue;
            try {
                unregister(module.getId());
            } catch (Exception e) {
                failures.add(new IllegalStateException("Module '" + module.getId() + "' failed to disable", e));
            }
        }
        ArtisanAPI boundApi = api;
        if (boundApi != null) {
            for (OwnedRegistry registry : owned(boundApi)) registry.unregisterLoadedBy(loader);
        }
        return failures;
    }

    private static void setOwner(ArtisanAPI api, @Nullable String moduleId) {
        for (OwnedRegistry registry : owned(api)) registry.bindOwner(moduleId);
    }

    /** The registries that record a module's registrations, in unregister order. */
    private static List<OwnedRegistry> owned(ArtisanAPI api) {
        return List.of(api.getDataSources(), api.getCommands(), api.getModels(), api.getScreens(), api.getActionRegistry(), api.getDocumentKinds(), api.getGameEvents(),
            api.getEditorBundles(), api.getTemplates(), api.getPlayerCommands());
    }

    private void signalChange() {
        Runnable callback = onChange;
        if (callback != null) callback.run();
    }

    /** An immutable snapshot of the active modules. */
    @Stable
    public List<ArtisanModule> active() {
        return List.copyOf(active);
    }

    /** True if a module with {@code id} is registered. */
    @Stable
    public boolean has(String id) {
        return active.stream().anyMatch(m -> m.getId().equals(id));
    }
}
