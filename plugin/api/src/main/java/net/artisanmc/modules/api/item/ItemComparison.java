package net.artisanmc.modules.api.item;

import java.util.Locale;
import net.artisanmc.modules.api.annotations.Stable;

/**
 * One criterion of {@link ItemStackApi#matches}: a stack matches an item spec when it agrees with
 * the spec's item on every criterion asked. The wire form is {@link #id()} (a module stores
 * {@code match: [material, name]} in its Document).
 */
@Stable
public enum ItemComparison {
    /** Same material. */
    MATERIAL,
    /** Same custom item ({@code nexo:ruby}…), or both vanilla. */
    CUSTOM_ITEM,
    /** Same display name, colours ignored; both without one also agree. */
    NAME,
    /** Same lore lines, colours ignored. */
    LORE,
    /** Every enchantment of the spec, at its level or higher; others are allowed. */
    ENCHANTS,
    /** Same custom model data. */
    CUSTOM_MODEL_DATA,
    /** No more worn than the spec's item: a damaged tool does not count for an intact one. */
    DAMAGE,
    /** Identical but for the amount (Bukkit {@code isSimilar}). */
    EXACT;

    /** {@code custom_item}, {@code name}… */
    public String id() {
        return name().toLowerCase(Locale.ROOT);
    }

    /** The comparison of a wire id, case-insensitive; null when unknown. */
    public static ItemComparison fromId(String id) {
        if (id == null) return null;
        for (ItemComparison c : values()) {
            if (c.id().equalsIgnoreCase(id.trim())) return c;
        }
        return null;
    }
}
