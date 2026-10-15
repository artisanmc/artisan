package net.artisanmc.modules.api;

import java.util.Objects;
import net.artisanmc.modules.api.annotations.Beta;
import org.jetbrains.annotations.Nullable;

/** A menu: its project folder and its id. {@link #toString()} is the {@code project:menu} form the Action DSL takes. */
@Beta
public final class MenuRef {
    private final @Nullable String projectId;
    private final String menuId;

    public MenuRef(@Nullable String projectId, String menuId) {
        this.projectId = projectId;
        this.menuId = Objects.requireNonNull(menuId, "menuId");
    }

    /** {@code shop:main}, or a bare {@code main} (no project). Throws {@link IllegalArgumentException} when malformed. */
    public static MenuRef parse(String ref) {
        int at = ref.indexOf(':');
        if (at == -1) {
            if (ref.isBlank()) throw new IllegalArgumentException("Empty menu ref");
            return new MenuRef(null, ref);
        }
        if (at == 0 || at == ref.length() - 1) throw new IllegalArgumentException("Malformed menu ref '" + ref + "'");
        return new MenuRef(ref.substring(0, at), ref.substring(at + 1));
    }

    public @Nullable String getProjectId() {
        return projectId;
    }

    public String getMenuId() {
        return menuId;
    }

    @Override
    public String toString() {
        return projectId == null || projectId.isEmpty() ? menuId : projectId + ":" + menuId;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof MenuRef other && Objects.equals(projectId, other.projectId) && menuId.equals(other.menuId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(projectId, menuId);
    }
}
