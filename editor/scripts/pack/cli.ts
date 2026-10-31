import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { TEXT_UP_TEXTURES, type TextUpTexture } from "@/lib/pack/fontJsonBuilder";
import type { OverlayImageRequest } from "@/lib/pack/overlayImages";
import { type PackProject, assembleServerPack } from "@/lib/pack/packAssembly";
import type { BuildResult } from "@/lib/pack/resourcePackBuilder";
import type { GuiContainer } from "@/lib/pack/vanillaGui";
import { sha256Hex } from "@/lib/sha256";
import { unzipSync } from "fflate";
import { parse } from "yaml";

const EDITOR = resolve(__dirname, "../..");
const VECTORS = resolve(EDITOR, "../testdata/resource-pack-conformance.json");

const USAGE = `Usage: npm run pack -- <command>

  build <projects-dir> [-o pack.zip] [--config config.yml] [--overlay-images images.json]
      Builds the server's Java pack from Project folders on disk (one folder per Project,
      named by its id), as the editor would after a publication. Module images
      (pack.images) come from the modules' editor bundles, which this command does not
      load: pass what they ask for with --overlay-images ({ "<project>": [{ "asset", "rise" }] }).

  vectors [--write]
      Rebuilds every case of testdata/resource-pack-conformance.json and compares its
      entries, per-entry SHA-256 and zip SHA-1. --write stores the new values instead.
`;

export async function main(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  try {
    if (command === "build") return await build(rest);
    if (command === "vectors") return await vectors(rest.includes("--write"));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }
  console.error(USAGE);
  return 2;
}

// --- shared inputs ----------------------------------------------------------------------------

const VANILLA_FILE: Record<GuiContainer, string> = {
  chest: "generic_54",
  hopper: "hopper",
  dispenser: "dispenser",
};

const asset = (path: string) =>
  new Uint8Array(readFileSync(resolve(EDITOR, "src/assets/minecraft", path)));

const vanillaTexture = async (container: GuiContainer) => asset(`${VANILLA_FILE[container]}.png`);

const textUp = () =>
  Object.fromEntries(
    TEXT_UP_TEXTURES.map((name) => [name, asset(`font/${name}_up.png`)]),
  ) as Record<TextUpTexture, Uint8Array>;

// --- build --------------------------------------------------------------------------------------

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

/** Text the pack reads (YAML descriptors and menus); anything else is a binary. */
const TEXT = /\.(ya?ml|json|txt|md)$/i;

function walk(dir: string, root = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const rel = relative(root, path).split("\\").join("/");
    // `.artisan*` as first segment is metadata, outside the Project (invariants.md).
    if (rel.startsWith(".artisan")) continue;
    if (statSync(path).isDirectory()) out.push(...walk(path, root));
    else out.push(rel);
  }
  return out;
}

export function projectFromDisk(
  id: string,
  dir: string,
  overlayImages?: OverlayImageRequest[],
): PackProject {
  const files: PackProject["files"] = [];
  const bytesOf = new Map<string, Uint8Array>();
  for (const path of walk(dir)) {
    if (TEXT.test(path)) files.push({ path, content: readFileSync(join(dir, path), "utf-8") });
    else bytesOf.set(path, new Uint8Array(readFileSync(join(dir, path))));
  }
  return {
    id,
    files,
    binaries: [...bytesOf].map(([path, bytes]) => ({
      path,
      hash: sha256Hex(bytes),
      size: bytes.length,
    })),
    binary: async (path) => bytesOf.get(path),
    overlayImages,
  };
}

/** `resource-pack.container-textures.*` of a server's `config.yml`, nested or flat. */
function containerTextures(configPath: string | undefined): Partial<Record<GuiContainer, string>> {
  if (!configPath) return {};
  const config = parse(readFileSync(configPath, "utf-8")) as Record<string, unknown> | null;
  const nested = (config?.["resource-pack"] as Record<string, unknown> | undefined)?.[
    "container-textures"
  ] as Record<string, unknown> | undefined;
  const out: Partial<Record<GuiContainer, string>> = {};
  for (const c of Object.keys(VANILLA_FILE) as GuiContainer[]) {
    const value = nested?.[c] ?? config?.[`resource-pack.container-textures.${c}`];
    if (typeof value === "string" && value.includes(":")) out[c] = value;
  }
  return out;
}

async function build(args: string[]): Promise<number> {
  const dir = args.find((a, i) => !a.startsWith("-") && !args[i - 1]?.startsWith("-"));
  if (!dir) {
    console.error(USAGE);
    return 2;
  }
  const out = option(args, "-o") ?? "pack.zip";
  const imagesPath = option(args, "--overlay-images");
  const images = imagesPath
    ? (JSON.parse(readFileSync(imagesPath, "utf-8")) as Record<string, OverlayImageRequest[]>)
    : {};
  const projects = readdirSync(dir)
    .filter((name) => !name.startsWith(".") && statSync(join(dir, name)).isDirectory())
    .map((id) => projectFromDisk(id, join(dir, id), images[id]));
  if (!imagesPath) console.warn("No --overlay-images: module images (pack.images) are left out.");
  const { zipBytes, hash } = await assembleServerPack({
    projects,
    containerTextures: containerTextures(option(args, "--config")),
    vanillaTexture,
    textUp: textUp(),
  });
  writeFileSync(out, zipBytes);
  console.log(`${out}  ${projects.length} project(s)  ${zipBytes.length} bytes  sha1 ${hash}`);
  return 0;
}

// --- vectors ------------------------------------------------------------------------------------

export interface ConformanceCase {
  name: string;
  projects: {
    id: string;
    files: Record<string, string>;
    binaries: Record<string, string>;
    /** What the Project's module kinds ask for (`pack.images`), as the kinds would return it. */
    overlayImages?: OverlayImageRequest[];
  }[];
  containerTextures: Partial<Record<GuiContainer, string>>;
  vanillaGui: boolean;
  entries: string[];
  /** SHA-256 of each entry listed in `entries`: says which file drifted when `sha1` does. */
  entryHashes?: Record<string, string>;
  textYFonts: number;
  textUpFonts: number;
  sha1: string;
}

export const TEXT_Y = /^assets\/artisan\/font\/text_y-?\d+_h\d+\.json$/;
export const TEXT_UP = /^assets\/artisan\/font\/text_up\d+\.json$/;

/** A case's pack, built from its inputs alone. */
export function buildCase(c: ConformanceCase): Promise<BuildResult> {
  const projects: PackProject[] = c.projects.map((p) => {
    const bytesOf = new Map(
      Object.entries(p.binaries).map(([path, b64]) => [
        path,
        new Uint8Array(Buffer.from(b64, "base64")),
      ]),
    );
    return {
      id: p.id,
      files: Object.entries(p.files).map(([path, content]) => ({ path, content })),
      binaries: [...bytesOf].map(([path, bytes]) => ({
        path,
        hash: sha256Hex(bytes),
        size: bytes.length,
      })),
      binary: async (path) => bytesOf.get(path),
      overlayImages: p.overlayImages,
    };
  });
  return assembleServerPack({
    projects,
    containerTextures: c.containerTextures,
    vanillaTexture,
    textUp: textUp(),
    transparentContainers: c.vanillaGui,
  });
}

/** What a case's pack is expected to be, computed from the pack itself. */
export function expectedOf(result: BuildResult) {
  const entries = unzipSync(result.zipBytes);
  const names = Object.keys(entries).sort();
  const listed = names.filter((e) => !TEXT_Y.test(e) && !TEXT_UP.test(e));
  return {
    entries: listed,
    entryHashes: Object.fromEntries(listed.map((e) => [e, sha256Hex(entries[e]!)])),
    textYFonts: names.filter((e) => TEXT_Y.test(e)).length,
    textUpFonts: names.filter((e) => TEXT_UP.test(e)).length,
    sha1: result.hash,
  };
}

async function vectors(write: boolean): Promise<number> {
  const doc = JSON.parse(readFileSync(VECTORS, "utf-8")) as { cases: ConformanceCase[] };
  let drift = 0;
  for (const c of doc.cases) {
    const expected = expectedOf(await buildCase(c));
    const changed = (Object.keys(expected) as (keyof typeof expected)[]).filter(
      (k) => JSON.stringify(c[k]) !== JSON.stringify(expected[k]),
    );
    if (changed.length > 0) {
      drift++;
      console.log(`${write ? "updated" : "drift"}: ${c.name} (${changed.join(", ")})`);
    }
    Object.assign(c, expected);
  }
  if (write) writeFileSync(VECTORS, `${JSON.stringify(doc, null, 2)}\n`);
  else if (drift === 0) console.log(`${doc.cases.length} case(s), no drift.`);
  return write || drift === 0 ? 0 : 1;
}
