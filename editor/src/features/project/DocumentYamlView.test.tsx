import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DocumentYamlView } from "./DocumentYamlView";
import { writeProjectFiles } from "@/lib/api/projectFiles";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import type { Project, ProjectId } from "@/domain/types";

vi.mock("@/lib/api/projectFiles", () => ({ writeProjectFiles: vi.fn(async () => ({ ok: true })) }));

// Re-parsing the Project after the write is tested elsewhere; this isolates
// what goes over the wire.
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
 * The YAML tab writes **verbatim**. Canonicalising even from this tab erased
 * an admin's comments on their own menus. Since the disk is the only store,
 * what you type is what lands.
 */
describe("DocumentYamlView", () => {
  beforeEach(() => {
    vi.mocked(writeProjectFiles).mockClear();
    useProjectBaselineStore.setState({
      baselines: { p1: { "menus/accueil.yaml": ORIGINAL } },
    });
  });

  it("writes exactly the typed text, comments and spacing included", async () => {
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

  it("goes through compare-and-swap like any other write", async () => {
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
    // The hash covers the LOADED content, not the new one: writing verbatim does
    // not skip checking that the disk has not moved.
    expect(vi.mocked(writeProjectFiles).mock.calls[0]![3].files[0]!.base_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("saves nothing while the text has not changed", () => {
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
