// backend/src/lib/assetSeed.test.ts
import { describe, expect, test } from "bun:test";
import { zipSync, strToU8 } from "fflate";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { seedBundledAssets } from "./assetSeed";

function tmp(name: string): string {
  const dir = join(tmpdir(), `artisan-seed-${name}-${crypto.randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Writes a seed archive whose entries are relative to the data dir. */
function writeSeed(seedDir: string, name: string, files: Record<string, string>): void {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) entries[path] = strToU8(content);
  writeFileSync(join(seedDir, name), zipSync(entries));
}

describe("seedBundledAssets", () => {
  test("extracts bundled files that the data dir is missing", () => {
    const seedDir = tmp("seed");
    const dataDir = tmp("data");
    writeSeed(seedDir, "icons-1.21.4.zip", {
      "mc-assets/1.21.4/textures/icons/stone.png": "PNG",
      "items/1.21.4.json": "[]",
    });

    const res = seedBundledAssets({ seedDir, dataDir });

    expect(res.extracted).toBe(2);
    expect(readFileSync(join(dataDir, "mc-assets/1.21.4/textures/icons/stone.png"), "utf8")).toBe("PNG");
    expect(readFileSync(join(dataDir, "items/1.21.4.json"), "utf8")).toBe("[]");
    rmSync(seedDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  // Le volume est la vérité : un fichier déjà présent (re-seedé à la main, ou
  // régénéré) ne doit jamais être écrasé par la copie de l'image.
  test("never overwrites a file already in the data dir", () => {
    const seedDir = tmp("seed");
    const dataDir = tmp("data");
    writeSeed(seedDir, "icons-1.21.4.zip", { "items/1.21.4.json": "from-image" });
    mkdirSync(join(dataDir, "items"), { recursive: true });
    writeFileSync(join(dataDir, "items/1.21.4.json"), "from-volume");

    const res = seedBundledAssets({ seedDir, dataDir });

    expect(res.extracted).toBe(0);
    expect(res.skipped).toBe(1);
    expect(readFileSync(join(dataDir, "items/1.21.4.json"), "utf8")).toBe("from-volume");
    rmSync(seedDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("is a no-op without a seed directory", () => {
    const dataDir = tmp("data");
    const res = seedBundledAssets({ seedDir: join(dataDir, "nope"), dataDir });
    expect(res).toEqual({ extracted: 0, skipped: 0 });
    rmSync(dataDir, { recursive: true, force: true });
  });

  // Une archive corrompue ne doit pas empêcher le backend de démarrer.
  test("survives a corrupt archive", () => {
    const seedDir = tmp("seed");
    const dataDir = tmp("data");
    writeFileSync(join(seedDir, "icons-broken.zip"), "not a zip");
    expect(() => seedBundledAssets({ seedDir, dataDir })).not.toThrow();
    rmSync(seedDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  // Défense en profondeur : une entrée qui remonte hors du dataDir est ignorée.
  test("ignores entries escaping the data dir", () => {
    const seedDir = tmp("seed");
    const dataDir = tmp("data");
    writeSeed(seedDir, "icons-evil.zip", { "../escaped.json": "nope" });

    const res = seedBundledAssets({ seedDir, dataDir });

    expect(res.extracted).toBe(0);
    expect(existsSync(join(dataDir, "..", "escaped.json"))).toBe(false);
    rmSync(seedDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });
});
