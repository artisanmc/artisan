import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DocumentYamlView } from "./DocumentYamlView";
import { writeProjectFiles } from "@/lib/api/projectFiles";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import type { Project, ProjectId } from "@/domain/types";

vi.mock("@/lib/api/projectFiles", () => ({ writeProjectFiles: vi.fn(async () => ({ ok: true })) }));

// Le re-parse du Project après écriture est testé ailleurs ; ici on isole ce qui
// part sur le fil.
vi.mock("@/features/project/saveProjectToDisk", () => ({
  adoptDiskIntoProject: vi.fn((p: unknown) => p),
}));

vi.mock("@/components/ui/yaml-code-editor", () => ({
  YamlCodeEditor: ({
    value,
    onChange,
    ariaLabel,
  }: { value: string; onChange: (v: string) => void; ariaLabel: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const ORIGINAL = "# portage zMenu\nschema: menu/v1\n\nsize:   27\n";

function project(): Project {
  return {
    id: "p1" as ProjectId,
    diskId: "boutique",
    name: "B",
    menus: [],
    commands: [],
    dialogs: [],
    i18nKeys: {},
  } as unknown as Project;
}

/**
 * L'onglet YAML écrit **verbatim**. L'ADR `yaml-assisted-editing` canonicalisait
 * même depuis cet onglet — c'est ce qui effaçait les commentaires d'un admin sur
 * ses propres menus. Depuis que le disque est le seul store, ce que tu tapes est
 * ce qui atterrit.
 */
describe("DocumentYamlView", () => {
  beforeEach(() => {
    vi.mocked(writeProjectFiles).mockClear();
    useProjectBaselineStore.setState({
      baselines: { p1: { "menus/accueil.yaml": ORIGINAL } },
    });
  });

  it("écrit exactement le texte tapé, commentaires et espacement compris", async () => {
    render(
      <DocumentYamlView
        project={project()}
        relPath="menus/accueil.yaml"
        networkId="n1"
        serverId="s1"
      />,
    );
    const edited = "# portage zMenu, corrigé\nschema: menu/v1\n\nsize:   54\n";
    fireEvent.change(screen.getByLabelText("menus/accueil.yaml"), { target: { value: edited } });
    fireEvent.click(screen.getByRole("button", { name: /Save|Enregistrer/ }));

    await waitFor(() => expect(writeProjectFiles).toHaveBeenCalled());
    const plan = vi.mocked(writeProjectFiles).mock.calls[0]![3];
    expect(plan.files[0]!.content).toBe(edited);
    expect(plan.files[0]!.path).toBe("menus/accueil.yaml");
  });

  it("passe par le compare-and-swap comme n'importe quelle écriture", async () => {
    render(
      <DocumentYamlView
        project={project()}
        relPath="menus/accueil.yaml"
        networkId="n1"
        serverId="s1"
      />,
    );
    fireEvent.change(screen.getByLabelText("menus/accueil.yaml"), { target: { value: "x\n" } });
    fireEvent.click(screen.getByRole("button", { name: /Save|Enregistrer/ }));

    await waitFor(() => expect(writeProjectFiles).toHaveBeenCalled());
    // Le hash porte sur le contenu CHARGÉ, pas sur le nouveau : écrire verbatim
    // ne dispense pas de vérifier que le disque n'a pas bougé.
    expect(vi.mocked(writeProjectFiles).mock.calls[0]![3].files[0]!.base_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("n'enregistre rien tant que le texte n'a pas changé", () => {
    render(
      <DocumentYamlView
        project={project()}
        relPath="menus/accueil.yaml"
        networkId="n1"
        serverId="s1"
      />,
    );
    expect(screen.getByRole("button", { name: /Save|Enregistrer/ })).toBeDisabled();
  });
});
