package net.artisanmc.modules.api;

import net.artisanmc.modules.api.annotations.Stable;

/** Minimal SemVer compare for add-on ↔ API compatibility (same major; running &gt;= min). */
@Stable
public final class SemVer {
    private SemVer() {}

    /** True if {@code core} is the same major as {@code min} and &gt;= it. A {@code -SUFFIX} is ignored. */
    @Stable
    public static boolean satisfies(String core, String min) {
        int[] c = parse(core);
        int[] m = parse(min);
        if (c[0] != m[0]) return false;
        if (c[1] != m[1]) return c[1] > m[1];
        return c[2] >= m[2];
    }

    private static int[] parse(String version) {
        int dash = version.indexOf('-');
        String[] parts = (dash == -1 ? version : version.substring(0, dash)).split("\\.");
        int[] out = new int[3];
        for (int i = 0; i < 3 && i < parts.length; i++) {
            try {
                out[i] = Integer.parseInt(parts[i]);
            } catch (NumberFormatException e) {
                out[i] = 0;
            }
        }
        return out;
    }
}
