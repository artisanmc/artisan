package net.artisanmc.modules.api.text;

import net.artisanmc.modules.api.annotations.Beta;
import org.jetbrains.annotations.Nullable;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * A HUD laid out as layers ({@link OverlayApi#compose}): images, and named places a module fills
 * when it draws ({@link OverlayContent}). Layers are drawn in order, the first under the others.
 *
 * <p>Positions are in GUI px from the slot's origin: x from the centre of the screen, y from the
 * top of the slot's text line, <b>downwards</b> (the opposite of a rise: {@code rise = -y}). The
 * top of anything drawn stays within {@link #MIN_Y}..{@link #MAX_Y}, the reach of the pack's
 * fonts. A module keeps a layout in its files as a YAML list and reads it with {@link #read}:
 *
 * <pre>{@code
 * - image: taverne_boite            # an image of the Project's assets/, at its size
 *   x: -130
 *   y: -92
 * - image_slot: portrait            # an image the module picks when it draws
 *   x: -190
 *   y: 8
 *   anchor: bottom                  # y is the image's bottom (top by default)
 *   default: portrait_inconnu       # drawn when the module gives none (none by default)
 * - text: lines                     # rows of text the module gives
 *   x: -120
 *   y: -72
 *   width: 240
 *   lines: 3                        # rows shown (1 by default)
 *   row: 11                         # px from one row's top to the next (11 by default)
 *   align: left                     # left, center, right
 * - list: choices                   # rows with one selected, scrolled by the module
 *   x: -110
 *   y: -31
 *   width: 230
 *   lines: 3
 *   cursor: { image: taverne_curseur, x: -10, y: 1 }   # beside the selected row
 * }</pre>
 *
 * <p>Same format and geometry in the editor (conformance vectors
 * {@code testdata/overlay-layout-conformance.json}).
 *
 * @since 2.21.0
 */
@Beta
public final class OverlayLayout {

    /** Highest top of a layer: 128 px above the slot's text ({@link OverlayApi#MAX_RISE}). */
    public static final int MIN_Y = -OverlayApi.MAX_RISE;
    /** Lowest top of a layer: 166 px under the slot's text ({@link OverlayApi#MIN_RISE}). */
    public static final int MAX_Y = -OverlayApi.MIN_RISE;
    /** Default distance between two rows' tops: the vanilla line. */
    public static final int DEFAULT_ROW = 11;

    static final int MAX_X = 1024;
    static final int MAX_WIDTH = 1024;
    static final int MAX_LINES = 32;
    static final int MAX_ROW = 64;
    static final int MAX_CURSOR_OFFSET = 64;

    /** One layer. */
    public sealed interface Layer permits Image, ImageSlot, Text, Rows {
        int x();

        int y();
    }

    /** A fixed image of the Project's {@code assets/}, its top left at (x, y), at its own size. */
    public record Image(String asset, int x, int y) implements Layer {}

    /** Where an image's y is measured. */
    public enum Anchor { TOP, BOTTOM }

    /**
     * An image the module names when it draws ({@link OverlayContent.Builder#image}): a speaker's
     * portrait. {@code fallback} (YAML {@code default}) is drawn when the module names none.
     */
    public record ImageSlot(String slot, int x, int y, Anchor anchor, @Nullable String fallback) implements Layer {
        public ImageSlot(String slot, int x, int y, Anchor anchor) {
            this(slot, x, y, anchor, null);
        }
    }

    /** How a row sits in its layer's width. */
    public enum Align { LEFT, CENTER, RIGHT }

    /** Up to {@code lines} rows of text, the first's top at (x, y), each {@code row} px under the last. */
    public record Text(String slot, int x, int y, int width, int lines, int row, Align align) implements Layer {}

    /** An image beside the selected row of a {@link Rows}, its top left at (x, y) from that row's. */
    public record Cursor(String asset, int x, int y) {}

    /** Rows with one selected: {@code lines} of them shown from the module's first visible row. */
    public record Rows(String slot, int x, int y, int width, int lines, int row, @Nullable Cursor cursor)
            implements Layer {}

    /**
     * Something wrong in a layout's YAML: where ({@code layout[2].width}), a stable code, what was read.
     * Codes: {@code not_a_list}, {@code not_a_layer}, {@code unknown_layer}, {@code missing_name},
     * {@code missing_field}, {@code not_a_number}, {@code out_of_range}, {@code unknown_value},
     * {@code duplicate_slot}.
     */
    public record Problem(String path, String code, String detail) {}

    /** A layout read from YAML: the layers that are right, and the problems of the others. */
    public record Read(OverlayLayout layout, List<Problem> problems) {}

    /**
     * An image the pack must hold for this layout to draw it ({@code pack.images}): at a
     * {@code rise}, or by its {@code bottom} (an {@code image_slot} anchored {@code bottom}, whose
     * rise the pack builder takes from the image's height). Exactly one of the two is set.
     */
    public record PackImage(String asset, @Nullable Integer rise, @Nullable Integer bottom) {
        public static PackImage at(String asset, int rise) {
            return new PackImage(asset, rise, null);
        }

        public static PackImage byBottom(String asset, int bottom) {
            return new PackImage(asset, null, bottom);
        }
    }

    private final List<Layer> layers;

    public OverlayLayout(List<? extends Layer> layers) {
        this.layers = List.copyOf(layers);
    }

    public List<Layer> getLayers() {
        return layers;
    }

    /**
     * The images this layout draws by itself, in layer order: each {@link Image}, each cursor at
     * every row of its list, each {@link ImageSlot}'s default. The other images of a slot are the
     * module's: {@link #slotPackImage}.
     */
    public List<PackImage> getPackImages() {
        List<PackImage> out = new ArrayList<>();
        for (Layer layer : layers) {
            if (layer instanceof Image image) {
                out.add(PackImage.at(image.asset(), -image.y()));
            } else if (layer instanceof ImageSlot slot && slot.fallback() != null) {
                out.add(slotPackImage(slot, slot.fallback(), 0));
            } else if (layer instanceof Rows rows && rows.cursor() != null) {
                for (int i = 0; i < rows.lines(); i++) {
                    out.add(PackImage.at(rows.cursor().asset(), -(rows.y() + i * rows.row() + rows.cursor().y())));
                }
            }
        }
        return out;
    }

    /** What the pack must hold for {@code asset} drawn in {@code slot}, moved {@code dy} px down. */
    public static PackImage slotPackImage(ImageSlot slot, String asset, int dy) {
        return slot.anchor() == Anchor.BOTTOM
                ? PackImage.byBottom(asset, slot.y() + dy)
                : PackImage.at(asset, -(slot.y() + dy));
    }

    /** The rise of an image {@code height} px tall put in {@code slot}. */
    public static int slotRise(ImageSlot slot, int height) {
        return slotRise(slot, height, 0);
    }

    /** The rise of an image {@code height} px tall put in {@code slot}, moved {@code dy} px down. */
    public static int slotRise(ImageSlot slot, int height, int dy) {
        int y = slot.y() + dy;
        return slot.anchor() == Anchor.BOTTOM ? height - y : -y;
    }

    /**
     * A layout from its YAML ({@code List} of maps, as SnakeYAML reads it). A layer with a problem
     * is left out; the others are kept. Null or absent reads as an empty layout.
     */
    public static Read read(@Nullable Object yaml) {
        List<Problem> problems = new ArrayList<>();
        List<Layer> layers = new ArrayList<>();
        if (yaml == null) return new Read(new OverlayLayout(layers), problems);
        if (!(yaml instanceof List<?> list)) {
            problems.add(new Problem("layout", "not_a_list", String.valueOf(yaml)));
            return new Read(new OverlayLayout(layers), problems);
        }
        Set<String> slots = new HashSet<>();
        for (int i = 0; i < list.size(); i++) {
            String path = "layout[" + i + "]";
            Layer layer = new Reader(path, list.get(i), problems).layer();
            if (layer == null) continue;
            String slot = switch (layer) {
                case ImageSlot s -> s.slot();
                case Text t -> t.slot();
                case Rows r -> r.slot();
                case Image ignored -> null;
            };
            if (slot != null && !slots.add(slot)) {
                problems.add(new Problem(path, "duplicate_slot", slot));
                continue;
            }
            layers.add(layer);
        }
        return new Read(new OverlayLayout(layers), problems);
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof OverlayLayout other && layers.equals(other.layers);
    }

    @Override
    public int hashCode() {
        return layers.hashCode();
    }

    @Override
    public String toString() {
        return "OverlayLayout" + layers;
    }

    /** Reads one layer, adding its problems; null when it cannot be drawn. */
    private static final class Reader {
        private static final List<String> KINDS = List.of("image", "image_slot", "text", "list");

        private final String path;
        private final @Nullable Object src;
        private final List<Problem> problems;
        private boolean bad;

        Reader(String path, @Nullable Object src, List<Problem> problems) {
            this.path = path;
            this.src = src;
            this.problems = problems;
        }

        @Nullable Layer layer() {
            if (!(src instanceof Map<?, ?> map)) {
                problem(path, "not_a_layer", String.valueOf(src));
                return null;
            }
            List<String> kinds = KINDS.stream().filter(map::containsKey).toList();
            if (kinds.size() != 1) {
                problem(path, "unknown_layer", kinds.isEmpty() ? String.valueOf(map.keySet()) : String.join(", ", kinds));
                return null;
            }
            String kind = kinds.get(0);
            String name = name(map, kind, path + "." + kind);
            int x = number(map, "x", 0, -MAX_X, MAX_X);
            int y = number(map, "y", 0, MIN_Y, MAX_Y);
            Layer layer = switch (kind) {
                case "image" -> new Image(name, x, y);
                case "image_slot" -> new ImageSlot(name, x, y, choice(map, "anchor", Anchor.TOP, Anchor.values()),
                        map.get("default") == null ? null : name(map, "default", path + ".default"));
                case "text" -> {
                    int width = required(map, "width", 1, MAX_WIDTH);
                    int row = number(map, "row", DEFAULT_ROW, 1, MAX_ROW);
                    int lines = lines(map, y, row);
                    yield new Text(name, x, y, width, lines, row, choice(map, "align", Align.LEFT, Align.values()));
                }
                default -> {
                    int width = required(map, "width", 1, MAX_WIDTH);
                    int row = number(map, "row", DEFAULT_ROW, 1, MAX_ROW);
                    int lines = lines(map, y, row);
                    yield new Rows(name, x, y, width, lines, row, cursor(map.get("cursor"), y, lines, row));
                }
            };
            return bad ? null : layer;
        }

        /** Rows shown; the last one's top must stay in reach. */
        private int lines(Map<?, ?> map, int y, int row) {
            int lines = number(map, "lines", 1, 1, MAX_LINES);
            if (!bad && y + (lines - 1) * row > MAX_Y) problem(path + ".lines", "out_of_range", String.valueOf(lines));
            return lines;
        }

        private @Nullable Cursor cursor(@Nullable Object value, int y, int lines, int row) {
            if (value == null) return null;
            String at = path + ".cursor";
            if (!(value instanceof Map<?, ?> map)) {
                problem(at, "not_a_layer", String.valueOf(value));
                return null;
            }
            String asset = name(map, "image", at + ".image");
            int cx = number(map, "x", 0, -MAX_CURSOR_OFFSET, MAX_CURSOR_OFFSET, at);
            int cy = number(map, "y", 0, -MAX_CURSOR_OFFSET, MAX_CURSOR_OFFSET, at);
            if (!bad && (y + cy < MIN_Y || y + (lines - 1) * row + cy > MAX_Y)) {
                problem(at + ".y", "out_of_range", String.valueOf(cy));
            }
            return new Cursor(asset, cx, cy);
        }

        private String name(Map<?, ?> map, String key, String at) {
            Object value = map.get(key);
            String name = value instanceof String s ? s.trim() : "";
            if (name.isEmpty()) problem(at, "missing_name", String.valueOf(value));
            return name;
        }

        private int required(Map<?, ?> map, String key, int min, int max) {
            if (map.get(key) == null) {
                problem(path + "." + key, "missing_field", "");
                return min;
            }
            return number(map, key, min, min, max);
        }

        private int number(Map<?, ?> map, String key, int fallback, int min, int max) {
            return number(map, key, fallback, min, max, path);
        }

        private int number(Map<?, ?> map, String key, int fallback, int min, int max, String at) {
            Object value = map.get(key);
            if (value == null) return fallback;
            if (!(value instanceof Integer || value instanceof Long)) {
                problem(at + "." + key, "not_a_number", String.valueOf(value));
                return fallback;
            }
            long n = ((Number) value).longValue();
            if (n < min || n > max) {
                problem(at + "." + key, "out_of_range", String.valueOf(n));
                return fallback;
            }
            return (int) n;
        }

        private <E extends Enum<E>> E choice(Map<?, ?> map, String key, E fallback, E[] values) {
            Object value = map.get(key);
            if (value == null) return fallback;
            String text = String.valueOf(value).trim().toUpperCase(Locale.ROOT);
            for (E e : values) if (e.name().equals(text)) return e;
            problem(path + "." + key, "unknown_value", String.valueOf(value));
            return fallback;
        }

        private void problem(String at, String code, String detail) {
            problems.add(new Problem(at, code, detail));
            bad = true;
        }
    }
}
