package net.artisanmc.modules.api.text;

import net.artisanmc.modules.api.annotations.Beta;
import org.jetbrains.annotations.Nullable;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * What fills the named layers of an {@link OverlayLayout} for one frame: the rows of a
 * {@code text}, the rows and selection of a {@code list}, the image of an {@code image_slot}. Rows
 * are MiniMessage, already cut to the layer's width by the module ({@link OverlayApi#width}). A
 * layer left unfilled draws nothing.
 *
 * @since 2.21.0
 */
@Beta
public final class OverlayContent {

    /** The rows of a {@code list}: {@code selected} is a row of {@code rows} or -1, {@code top} the first shown. */
    public record Rows(List<String> rows, int selected, int top) {
        public Rows {
            rows = List.copyOf(rows);
        }
    }

    /** Nothing in any layer. */
    public static final OverlayContent EMPTY = builder().build();

    private final Map<String, List<String>> texts;
    private final Map<String, Rows> lists;
    private final Map<String, String> images;

    private OverlayContent(Builder builder) {
        texts = Map.copyOf(builder.texts);
        lists = Map.copyOf(builder.lists);
        images = Map.copyOf(builder.images);
    }

    public static Builder builder() {
        return new Builder();
    }

    /** The rows given to the {@code text} layer {@code slot}, or an empty list. */
    public List<String> text(String slot) {
        return texts.getOrDefault(slot, List.of());
    }

    /** The rows given to the {@code list} layer {@code slot}, or null. */
    public @Nullable Rows rows(String slot) {
        return lists.get(slot);
    }

    /** The asset given to the {@code image_slot} layer {@code slot}, or null. */
    public @Nullable String image(String slot) {
        return images.get(slot);
    }

    public static final class Builder {
        private final Map<String, List<String>> texts = new HashMap<>();
        private final Map<String, Rows> lists = new HashMap<>();
        private final Map<String, String> images = new HashMap<>();

        private Builder() {}

        /** The rows of the {@code text} layer {@code slot}; the layer shows its first {@code lines}. */
        public Builder text(String slot, List<String> rows) {
            texts.put(slot, List.copyOf(rows));
            return this;
        }

        /** The rows of the {@code list} layer {@code slot}, from {@code top}, {@code selected} (-1: none) beside its cursor. */
        public Builder rows(String slot, List<String> rows, int selected, int top) {
            lists.put(slot, new Rows(rows, selected, top));
            return this;
        }

        /** The asset drawn in the {@code image_slot} layer {@code slot}; null leaves it empty. */
        public Builder image(String slot, @Nullable String asset) {
            if (asset == null || asset.isBlank()) images.remove(slot);
            else images.put(slot, asset);
            return this;
        }

        public OverlayContent build() {
            return new OverlayContent(this);
        }
    }
}
