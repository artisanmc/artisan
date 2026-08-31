import { beforeEach, describe, expect, it } from "vitest";
import { useProjectBaselineStore } from "./projectBaselineStore";

/**
 * La base sert de repère « depuis quel chargement ce brouillon date-t-il ? », et
 * ce repère se lit par IDENTITÉ d'objet (`useDraftSync`). Reposer une base
 * identique en contenu mais nouvelle en mémoire faisait donc croire à un
 * nouveau chargement — et la synchro figeait alors `initialTree` sur l'arbre
 * courant, ce qui déclarait le brouillon PROPRE alors qu'il portait du travail.
 * Au rechargement suivant, ce travail était jeté.
 *
 * C'est devenu systématique quand la revalidation s'est mise à reposer la base
 * à chaque visite : ce qui était un cas rare est devenu le cas courant.
 */
describe("projectBaselineStore — l'identité ne change que si le contenu change", () => {
  beforeEach(() => {
    useProjectBaselineStore.setState({ baselines: {} } as never);
  });

  it("garde le même objet quand on repose un contenu identique", () => {
    const store = useProjectBaselineStore.getState();
    store.set("p1", { "menus/a.yaml": "x" });
    const first = store.get("p1");

    store.set("p1", { "menus/a.yaml": "x" });

    expect(useProjectBaselineStore.getState().get("p1")).toBe(first);
  });

  it("change d'objet dès qu'un contenu diffère", () => {
    const store = useProjectBaselineStore.getState();
    store.set("p1", { "menus/a.yaml": "x" });
    const first = store.get("p1");

    store.set("p1", { "menus/a.yaml": "modifié" });

    expect(useProjectBaselineStore.getState().get("p1")).not.toBe(first);
  });

  it("change d'objet quand un fichier apparaît ou disparaît", () => {
    const store = useProjectBaselineStore.getState();
    store.set("p1", { "menus/a.yaml": "x" });
    const first = store.get("p1");

    store.set("p1", { "menus/a.yaml": "x", "menus/b.yaml": "y" });
    expect(useProjectBaselineStore.getState().get("p1")).not.toBe(first);

    const second = useProjectBaselineStore.getState().get("p1");
    store.set("p1", { "menus/a.yaml": "x" });
    expect(useProjectBaselineStore.getState().get("p1")).not.toBe(second);
  });
});
