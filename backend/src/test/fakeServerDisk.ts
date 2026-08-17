import { createHash } from "crypto";

/**
 * Un disque de serveur simulé, pour les tests qui conduisent les routes d'assets
 * (ADR `assets-on-server-disk`).
 *
 * Depuis P5, le backend n'écrit plus les assets : il relaie vers le plugin, qui
 * est le seul écrivain. Sans serveur au bout du fil, toute écriture répond
 * « hors ligne » — c'est le comportement voulu, mais ça ne teste plus rien.
 * Ce faux disque tient donc le rôle du serveur, avec les mêmes règles :
 * compare-and-swap sur le hash, et des octets rendus à l'identique.
 */
export const diskText = new Map<string, string>();
export const diskBinary = new Map<string, Uint8Array>();

export function clearFakeDisk(): void {
  diskText.clear();
  diskBinary.clear();
}

export function hashOf(content: Uint8Array | string): string {
  return createHash("sha256")
    .update(typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content))
    .digest("hex");
}

/** Le module `../ws/hub` tel que le voient les handlers d'assets sous test. */
export function fakeHubModule(extra: Record<string, unknown> = {}) {
  return {
    pushResourcePackUpdated: () => {},
    handlePluginMessage: () => {},
    connSenders: new Map(),
    connToServerId: new Map(),
    requestProjectRead: async () => ({
      kind: "result",
      result: {
        ok: true,
        files: [...diskText].map(([path, content]) => ({ path, content })),
        binaries: [...diskBinary].map(([path, bytes]) => ({
          path,
          hash: hashOf(bytes),
          size: bytes.length,
        })),
      },
    }),
    requestAssetRead: async (_sk: string, req: { path: string }) => {
      const bytes = diskBinary.get(req.path);
      if (!bytes) return { kind: "result", result: { ok: false, error: "not_found" } };
      return {
        kind: "result",
        result: {
          ok: true,
          content_base64: Buffer.from(bytes).toString("base64"),
          hash: hashOf(bytes),
        },
      };
    },
    requestAssetWrite: async (
      _sk: string,
      req: { path: string; contentBase64: string | null; baseHash: string | null },
    ) => {
      const current = diskBinary.get(req.path);
      const actual = current ? hashOf(current) : null;
      // Le compare-and-swap est la règle du plugin : deux écritures qui
      // s'ignorent doivent se voir refusées ici comme là-bas.
      if (actual !== req.baseHash) {
        return { kind: "result", result: { ok: false, error: "conflict" } };
      }
      if (req.contentBase64 === null) diskBinary.delete(req.path);
      else diskBinary.set(req.path, new Uint8Array(Buffer.from(req.contentBase64, "base64")));
      return { kind: "result", result: { ok: true } };
    },
    requestProjectWrite: async (
      _sk: string,
      req: { files: { path: string; content: string }[]; deletes?: { path: string }[] },
    ) => {
      for (const f of req.files) diskText.set(f.path, f.content);
      for (const d of req.deletes ?? []) diskText.delete(d.path);
      return { kind: "result", result: { ok: true } };
    },
    ...extra,
  };
}
