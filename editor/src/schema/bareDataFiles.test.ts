// ADR bare-data-files: a data file may be PURE VALUES — mapping = object
// source, list = table — schema resolved beside it (models/<id>.yaml fields,
// or a one-line `model:` ref), untyped fallback preserving values verbatim.
// ltext import is tolerant: a value matching a known translation key resolves
// as that key; anything else is a literal in the default language (minted).
import type { DataSourceId, ProjectId } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { projectFromFiles } from "./projectFromFiles";

const PID = "p_bare" as ProjectId;
const base = `plugins/Artisan/projects/${PID}`;

function baseFiles(extra: Record<string, string>): Record<string, string> {
  return {
    [`${base}/manifest.yaml`]: "schema: manifest/v1\nproject_id: p_bare\ndefault_lang: en\nlanguages: [en, fr]\nfiles:\n  menus: []\n  commands: []\n",
    ...extra,
  };
}

describe("bare data files (ADR bare-data-files)", () => {
  it("bare mapping → config source, id from filename, values preserved verbatim", () => {
    const p = projectFromFiles(PID, baseFiles({
      [`${base}/data/shop_settings.yaml`]: "whole_shop_discount: 10\nmotd: Bienvenue\n",
    }), { name: "Bare" });

    const cfg = p.dataSources.find((d) => d.id === ("shop_settings" as DataSourceId));
    if (cfg?.shape !== "config") throw new Error("expected config shape");
    expect(cfg.value).toEqual({ whole_shop_discount: 10, motd: "Bienvenue" });
  });

  it("bare list → table source, rows preserved verbatim (untyped)", () => {
    const p = projectFromFiles(PID, baseFiles({
      [`${base}/data/warps.yaml`]: "- id: spawn\n  name: Le spawn\n  cost: 5\n- id: arena\n  name: L'arène\n",
    }), { name: "Bare" });

    const t = p.dataSources.find((d) => d.id === ("warps" as DataSourceId));
    if (t?.shape !== "table") throw new Error("expected table shape");
    expect(t.rows).toEqual([
      { id: "spawn", name: "Le spawn", cost: 5 },
      { id: "arena", name: "L'arène" },
    ]);
  });

  it("models/<sourceId>.yaml types a bare table — known key resolves, literal mints defaultLang", () => {
    const p = projectFromFiles(PID, baseFiles({
      [`${base}/models/ranks.yaml`]:
        "schema: model/v1\nid: ranks\nname: Ranks\nfields:\n  - name: id\n    type: { kind: string }\n  - name: name\n    type: { kind: ltext }\n",
      [`${base}/lang/en.yaml`]: "sources.ranks.vip.name: VIP\n",
      [`${base}/lang/fr.yaml`]: "sources.ranks.vip.name: V.I.P.\n",
      [`${base}/data/ranks.yaml`]:
        "- id: vip\n  name: sources.ranks.vip.name\n- id: mvp\n  name: MVP direct\n",
    }), { name: "Bare" });

    const t = p.dataSources.find((d) => d.id === ("ranks" as DataSourceId));
    if (t?.shape !== "table") throw new Error("expected table shape");
    expect(t.modelId).toBe("ranks");
    const [vip, mvp] = t.rows as { name: { key: string } }[];
    // Known key → LText ref, translations pulled back.
    expect(vip!.name.key).toBe("sources.ranks.vip.name");
    expect(p.i18nKeys["sources.ranks.vip.name"]).toEqual({ en: "VIP", fr: "V.I.P." });
    // Literal → minted key carrying the default language's text.
    expect(p.i18nKeys[mvp!.name.key]).toEqual({ en: "MVP direct" });
  });

  it("models/<sourceId>.yaml may be a one-line ref to a declared (namespaced) model", () => {
    const p = projectFromFiles(PID, baseFiles({
      [`${base}/models/categories.yaml`]: "model: boutique:category\n",
      [`${base}/data/categories.yaml`]: "- id: armes\n  name: Armes\n",
    }), { name: "Bare" });

    const t = p.dataSources.find((d) => d.id === ("categories" as DataSourceId));
    if (t?.shape !== "table") throw new Error("expected table shape");
    // Namespaced ref kept as-is (declared model injected after load); the
    // ref FILE itself never becomes a Data model.
    expect(t.modelId).toBe("boutique:category");
    expect(t.rows).toEqual([{ id: "armes", name: "Armes" }]);
    expect((p.dataModels ?? []).find((m) => String(m.id) === "boutique:category")).toBeUndefined();
  });

  it("per-row dir without _source.yaml — rows are all files sorted by name", () => {
    const p = projectFromFiles(PID, baseFiles({
      [`${base}/data/kits/beta.yaml`]: "id: beta\n",
      [`${base}/data/kits/alpha.yaml`]: "id: alpha\n",
    }), { name: "Bare" });

    const t = p.dataSources.find((d) => d.id === ("kits" as DataSourceId));
    if (t?.shape !== "table") throw new Error("expected table shape");
    expect(t.granularity).toBe("row");
    expect(t.rows.map((r) => (r as { id: string }).id)).toEqual(["alpha", "beta"]);
  });

  it("minimal _source.yaml — model ref + order, no fields, rows verbatim", () => {
    const p = projectFromFiles(PID, baseFiles({
      [`${base}/data/categories/_source.yaml`]: "model: boutique:category\norder: [outils, armes]\n",
      [`${base}/data/categories/armes.yaml`]: "id: armes\nname: Armes\n",
      [`${base}/data/categories/outils.yaml`]: "id: outils\nname: Outils\n",
    }), { name: "Bare" });

    const t = p.dataSources.find((d) => d.id === ("categories" as DataSourceId));
    if (t?.shape !== "table") throw new Error("expected table shape");
    expect(t.modelId).toBe("boutique:category");
    expect(t.rows.map((r) => (r as { id: string }).id)).toEqual(["outils", "armes"]);
    expect((t.rows[0] as { name: string }).name).toBe("Outils");
  });

  it("a mapping with an unrelated schema-like key stays a bare object (user data)", () => {
    const p = projectFromFiles(PID, baseFiles({
      [`${base}/data/db.yaml`]: "schema: public\nhost: localhost\n",
    }), { name: "Bare" });

    const cfg = p.dataSources.find((d) => d.id === ("db" as DataSourceId));
    if (cfg?.shape !== "config") throw new Error("expected config shape");
    expect(cfg.value).toEqual({ schema: "public", host: "localhost" });
  });
});
