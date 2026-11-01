package net.artisanmc.geyser;

import org.geysermc.event.subscribe.Subscribe;
import org.geysermc.geyser.api.event.bedrock.SessionLoadResourcePacksEvent;
import org.geysermc.geyser.api.event.lifecycle.GeyserPostInitializeEvent;
import org.geysermc.geyser.api.event.lifecycle.GeyserShutdownEvent;
import org.geysermc.geyser.api.extension.Extension;
import org.geysermc.geyser.api.pack.PackCodec;
import org.geysermc.geyser.api.pack.ResourcePack;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.HexFormat;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Artisan on a Geyser that runs away from the plugin (a Velocity or BungeeCord
 * proxy, a standalone Geyser): follows the Bedrock pack the editor built for
 * one Artisan server and hands it to each Bedrock player at connection, as the
 * plugin's own {@code GeyserIntegration} does when Geyser is on the server.
 *
 * <p>Every {@code poll} seconds it asks the hub for the server's current pack
 * ({@code GET /api/v1/servers/<id>/bedrock-pack}, public), downloads a new one
 * into this extension's folder under its SHA-1 and switches to it; a client
 * gets it at its next connection. The mapping of image buttons' click item
 * ({@code custom_mappings/artisan.json}) is written once; Geyser reads that
 * folder at startup, so the first install takes one restart.
 *
 * <p>Configuration, {@code extensions/artisan/config.yml}: {@code hub} (the
 * editor's address, as the plugin's {@code web.url}), {@code server} (the
 * Artisan server id, from {@code plugins/Artisan/server-id}), {@code poll}.
 */
public class ArtisanGeyserExtension implements Extension {
    private static final Pattern FIELD = Pattern.compile("\"(hash|url)\"\\s*:\\s*\"([^\"]*)\"");
    private static final Pattern HASH = Pattern.compile("[0-9a-f]{40}");
    /** Mirrors {@code GeyserIntegration.MAPPINGS} in the plugin. */
    static final String MAPPINGS = """
        {
          "format_version": 2,
          "items": {
            "minecraft:paper": [
              {
                "type": "definition",
                "model": "artisan:buttons/hit_area",
                "bedrock_identifier": "artisan:hit_area",
                "display_name": "Artisan hit area",
                "bedrock_options": { "icon": "artisan_hit_area" }
              }
            ]
          }
        }
        """;

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private ScheduledExecutorService poller;
    private volatile Path pack;
    private String hub = "";
    private String server = "";
    private long poll = 30;

    @Subscribe
    public void onPostInitialize(GeyserPostInitializeEvent event) {
        try {
            loadConfig();
            writeMappings();
            pack = newest(dataFolder());
            if (pack != null) logger().info("Bedrock pack " + pack.getFileName() + " ready for Bedrock players");
        } catch (IOException e) {
            logger().error("Artisan: cannot read its folder: " + e.getMessage());
            return;
        }
        if (hub.isEmpty() || server.isEmpty()) {
            logger().warning("Artisan: set `hub` and `server` in " + dataFolder().resolve("config.yml") + " to follow the server's Bedrock pack");
            return;
        }
        poller = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "artisan-geyser-pack");
            t.setDaemon(true);
            return t;
        });
        poller.scheduleWithFixedDelay(this::refresh, 0, Math.max(5, poll), TimeUnit.SECONDS);
    }

    @Subscribe
    public void onShutdown(GeyserShutdownEvent event) {
        if (poller != null) poller.shutdownNow();
    }

    @Subscribe
    public void onSessionLoadResourcePacks(SessionLoadResourcePacksEvent event) {
        Path file = pack;
        if (file == null) return;
        try {
            event.register(ResourcePack.create(PackCodec.path(file)));
        } catch (Exception e) {
            logger().warning("Artisan: Bedrock pack " + file.getFileName() + " refused by Geyser: " + e);
        }
    }

    /** One poll: the server's current `{hash, url}`, then the file if it is new. */
    void refresh() {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(hub + "/api/v1/servers/" + server + "/bedrock-pack"))
                .timeout(Duration.ofSeconds(20)).GET().build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() == 404) {
                if (pack != null) logger().info("Artisan: the server has no Bedrock pack any more");
                pack = null;
                return;
            }
            if (response.statusCode() != 200) {
                logger().warning("Artisan: " + request.uri() + " answered " + response.statusCode());
                return;
            }
            Map<String, String> current = parse(response.body());
            String hash = current.get("hash");
            String url = current.get("url");
            if (hash == null || url == null || !HASH.matcher(hash).matches()) {
                logger().warning("Artisan: unexpected answer from the hub: " + response.body());
                return;
            }
            Path target = dataFolder().resolve(hash + ".mcpack");
            if (pack != null && pack.equals(target)) return;
            if (!Files.isRegularFile(target)) download(URI.create(hub).resolve(url), hash, target);
            switchTo(target);
        } catch (Exception e) {
            logger().warning("Artisan: cannot follow the server's Bedrock pack: " + e); // the class too: a ConnectException has no message
        }
    }

    private void download(URI url, String hash, Path target) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(url).timeout(Duration.ofMinutes(2)).GET().build();
        HttpResponse<byte[]> response = http.send(request, HttpResponse.BodyHandlers.ofByteArray());
        if (response.statusCode() != 200) throw new IOException(url + " answered " + response.statusCode());
        byte[] bytes = response.body();
        String actual = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-1").digest(bytes));
        if (!actual.equals(hash)) throw new IOException("hash mismatch for " + url + ": expected " + hash + ", got " + actual);
        Files.createDirectories(target.getParent());
        Path tmp = target.resolveSibling(target.getFileName() + ".tmp");
        Files.write(tmp, bytes);
        Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    private void switchTo(Path file) throws IOException {
        pack = file;
        try (var files = Files.list(dataFolder())) {
            for (Path other : files.filter(p -> p.getFileName().toString().endsWith(".mcpack") && !p.equals(file)).toList()) {
                Files.deleteIfExists(other);
            }
        }
        logger().info("Artisan: Bedrock pack " + file.getFileName() + " ready, Bedrock players get it at their next connection");
    }

    private static Path newest(Path dir) throws IOException {
        if (!Files.isDirectory(dir)) return null;
        try (var files = Files.list(dir)) {
            return files.filter(p -> HASH.matcher(p.getFileName().toString().replace(".mcpack", "")).matches())
                .max((a, b) -> {
                    try { return Files.getLastModifiedTime(a).compareTo(Files.getLastModifiedTime(b)); } catch (IOException e) { return 0; }
                }).orElse(null);
        }
    }

    static Map<String, String> parse(String json) {
        Map<String, String> out = new java.util.HashMap<>();
        Matcher m = FIELD.matcher(json);
        while (m.find()) out.put(m.group(1), m.group(2));
        return out;
    }

    private void loadConfig() throws IOException {
        Path file = dataFolder().resolve("config.yml");
        if (!Files.isRegularFile(file)) {
            Files.createDirectories(dataFolder());
            Files.writeString(file, """
                # The Artisan editor's address (the plugin's `web.url`, or http://<server ip>:8765).
                hub: ""
                # The Artisan server whose menus this Geyser serves: `plugins/Artisan/server-id` on it.
                server: ""
                # Seconds between two checks of the server's current pack.
                poll: 30
                """);
        }
        for (String line : Files.readAllLines(file)) {
            String trimmed = line.strip();
            if (trimmed.startsWith("#") || !trimmed.contains(":")) continue;
            String key = trimmed.substring(0, trimmed.indexOf(':')).strip();
            String value = trimmed.substring(trimmed.indexOf(':') + 1).strip();
            if (value.length() >= 2 && (value.startsWith("\"") && value.endsWith("\"") || value.startsWith("'") && value.endsWith("'"))) {
                value = value.substring(1, value.length() - 1);
            }
            switch (key) {
                case "hub" -> hub = value.replaceAll("/+$", "");
                case "server" -> server = value;
                case "poll" -> { try { poll = Long.parseLong(value); } catch (NumberFormatException ignored) { } }
                default -> { }
            }
        }
    }

    private void writeMappings() throws IOException {
        Path file = this.geyserApi().configDirectory().resolve("custom_mappings").resolve("artisan.json");
        if (Files.isRegularFile(file) && Files.readString(file).equals(MAPPINGS)) return;
        Files.createDirectories(file.getParent());
        Files.writeString(file, MAPPINGS);
        logger().warning("Artisan: wrote " + file + ", restart Geyser once so it loads the mapping of image buttons");
    }
}
