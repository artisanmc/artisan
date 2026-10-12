// Version de l'API publique (net.artisanmc:artisan-core-api), déduite de la colonne
// `Since` de docs/architecture/api-surface.md : la plus haute version citée est la
// version courante. Utilisé par .github/workflows/publish-api.yml (release ou snapshot)
// et api-version-check.yml (une PR qui touche l'API doit annoncer une nouvelle version).
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
export const API_SOURCES = "plugin/api/src/main/";
export const API_SURFACE = "docs/architecture/api-surface.md";
export const NO_RELEASE_LABEL = "api:no-release";

export function compare(a, b) {
  const pa = a.match(SEMVER).slice(1).map(Number);
  const pb = b.match(SEMVER).slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

const max = (versions) => versions.reduce((m, v) => (m === null || compare(v, m) > 0 ? v : m), null);

/** Plus haute version citée comme `Since` : dernière cellule d'une ligne de tableau, ou « Since X.Y.Z » en prose. */
export function currentApiVersion(markdown) {
  const found = [];
  for (const line of markdown.split("\n")) {
    const cells = line.trim().match(/^\|(.*)\|$/)?.[1].split("|");
    const last = cells?.at(-1).trim();
    if (last && SEMVER.test(last)) found.push(last);
    for (const m of line.matchAll(/\b[Ss]ince (\d+\.\d+\.\d+)\b/g)) found.push(m[1]);
  }
  const version = max(found);
  if (!version) throw new Error(`No Since version found in ${API_SURFACE}`);
  return version;
}

/** Dernière release : plus haut tag strict `api-vX.Y.Z` (les pré-releases sont ignorées). */
export function latestRelease(tags) {
  return max(tags.map((t) => t.trim()).filter((t) => /^api-v\d+\.\d+\.\d+$/.test(t)).map((t) => t.slice("api-v".length)));
}

export function nextSnapshot(version) {
  const [, major, minor] = version.match(SEMVER);
  return `${major}.${Number(minor) + 1}.0-SNAPSHOT`;
}

/** Push sur main : release si la version documentée dépasse la dernière release, sinon snapshot. */
export function planPublish(markdown, tags) {
  const current = currentApiVersion(markdown);
  const latest = latestRelease(tags);
  if (latest === null || compare(current, latest) > 0) return { kind: "release", version: current };
  return { kind: "snapshot", version: nextSnapshot(latest) };
}

/** PR : un changement des sources de l'API doit monter la version documentée au-dessus de la dernière release. */
export function checkApiChange({ changedFiles, markdown, tags, labels = [] }) {
  if (!changedFiles.some((f) => f.startsWith(API_SOURCES))) return { ok: true, reason: "API sources unchanged" };
  if (labels.includes(NO_RELEASE_LABEL)) return { ok: true, reason: `label ${NO_RELEASE_LABEL}` };
  const current = currentApiVersion(markdown);
  const latest = latestRelease(tags);
  if (latest === null || compare(current, latest) > 0) return { ok: true, reason: `releases ${current}` };
  return {
    ok: false,
    reason:
      `API sources changed but ${API_SURFACE} still tops out at Since ${current} (latest release ${latest}). ` +
      `Mark new or changed members with the next version (e.g. ${nextSnapshot(latest).replace("-SNAPSHOT", "")}), ` +
      `or add the label "${NO_RELEASE_LABEL}" if the change does not affect the published API (KDoc, formatting).`,
  };
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);

function output(values) {
  for (const [k, v] of Object.entries(values)) {
    console.log(`${k}=${v}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const markdown = readFileSync(API_SURFACE, "utf8");
  const tags = git("tag", "-l", "api-v*");
  const [command, base] = process.argv.slice(2);
  if (command === "plan") {
    output(planPublish(markdown, tags));
  } else if (command === "check") {
    const result = checkApiChange({
      changedFiles: git("diff", "--name-only", `${base}...HEAD`),
      markdown,
      tags,
      labels: JSON.parse(process.env.PR_LABELS ?? "[]"),
    });
    console.log(result.reason);
    if (!result.ok) {
      console.log(`::error file=${API_SURFACE}::${result.reason}`);
      process.exit(1);
    }
  } else {
    console.error("usage: node deploy/api-version.mjs plan | check <base-ref>");
    process.exit(2);
  }
}
