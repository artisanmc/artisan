import type { Project } from "@/domain/types";
import { editorTourController } from "@/features/onboarding/editorTourRuntime";
import { useTourPresentation } from "@/features/onboarding/tourPresentation";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useDemoStore } from "@/state/demoStore";
import { useSelectionStore } from "@/state/selectionStore";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectCanvasPage } from "./ProjectWorkspace";
import { useProjectLibraryStore } from "./projectLibraryStore";

const setup = vi.hoisted(() => ({
  ready: true,
  tab: "overview",
  navigate: vi.fn(),
  project: null as Project | null,
}));
vi.mock("@tanstack/react-router", async () => ({
  ...(await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router")),
  useParams: () => ({ projectId: "demo" }),
  useNavigate: () => setup.navigate,
  useSearch: () => ({ tab: setup.tab }),
  useChildMatches: () => [],
  Navigate: () => null,
  Outlet: () => null,
}));
vi.mock("@/features/project/useProjectLoader", () => ({
  useProjectLoader: () => ({
    project: setup.ready ? setup.project : null,
    urlId: "demo",
    failed: [],
    offline: false,
    stale: false,
    error: null,
    fromDraft: false,
  }),
}));
vi.mock("@/components/LinkedServersDropdown", () => ({ LinkedServersDropdown: () => null }));
vi.mock("@/features/canvas/Stage", () => ({ Stage: () => <div>Demo canvas</div> }));
vi.mock("@/features/canvas/useTextureInit", () => ({ useTextureInit: () => {} }));
vi.mock("@/features/assets/useAssetInit", () => ({ useAssetInit: () => {} }));
vi.mock("@/features/canvas/EditorPane", () => ({ EditorPane: () => null }));
vi.mock("@/features/project/ProjectPanel", () => ({
  ProjectPanel: () => <div>Project elements</div>,
}));
vi.mock("@/features/assets/AssetsTab", () => ({ AssetsTab: () => <div>Resource library</div> }));
vi.mock("@/features/translations/TranslationPanel", () => ({
  TranslationPanelContent: () => null,
}));
vi.mock("@/features/data/DataSourcesPanel", () => ({ DataSourcesPanelContent: () => null }));
vi.mock("@/features/assistant/AssistantBody", () => ({ AssistantBody: () => null }));
vi.mock("@/features/help/PatternsGallery", () => ({ PatternsGallery: () => null }));
vi.mock("@/features/search/SearchPalette", () => ({ SearchPalette: () => null }));
vi.mock("@/lib/useMediaQuery", () => ({ useIsDesktop: () => true }));

beforeEach(() => {
  localStorage.clear();
  editorTourController.deactivate();
  useAuthStore.setState({ currentUser: null, isLoading: false });
  useDemoStore.setState({
    active: true,
    expired: false,
    session: {
      projectId: "p1",
      principal: { kind: "guest", id: "guest1" },
      csrfToken: "csrf",
      expiresAt: "2099-01-01T00:00:00Z",
    },
  });
  useSelectionStore.getState().clear();
  useProjectLibraryStore.getState().close();
  useTourPresentation.setState({ step: null });
  setup.ready = true;
  setup.tab = "overview";
  setup.project = {
    id: "p1",
    diskId: "demo",
    name: "Demo",
    defaultLang: "en",
    i18nKeys: {},
    menus: [],
    commands: [],
    dialogs: [],
    assets: [],
  } as unknown as Project;
  useAccountStore.setState((state) => ({
    account: { ...state.account, projects: [setup.project!], projectOrder: [setup.project!.id] },
  }));
  setup.navigate.mockClear();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(40, 80, 100, 80),
  );
});
afterEach(() => {
  editorTourController.deactivate();
  vi.restoreAllMocks();
});

it("starts only after a resolved demo workspace, then resumes from its real project menu", async () => {
  const user = userEvent.setup();
  setup.ready = false;
  const view = render(<ProjectCanvasPage projectRef="p1" />);
  await act(async () => {});
  expect(screen.queryByRole("dialog")).toBeNull();
  setup.ready = true;
  view.rerender(<ProjectCanvasPage projectRef="p1" />);
  await user.click(await screen.findByRole("button", { name: /Commencer|Let's go/ }));
  await user.click(screen.getByRole("button", { name: /Plus tard|Later/ }));
  await user.click(screen.getByRole("button", { name: /Plus d'actions|More actions/ }));
  await user.click(screen.getByRole("menuitem", { name: /Reprendre la visite|Resume the tour/ }));
  expect(
    await screen.findByRole("dialog", { name: /Un espace pour essayer|Your space to try things/ }),
  ).toBeInTheDocument();
});

it("restores a previously open secondary tab without changing the route or selection", async () => {
  const user = userEvent.setup();
  setup.tab = "resources";
  render(<ProjectCanvasPage projectRef="p1" />);
  await screen.findByRole("dialog");
  expect(screen.getByTestId("open-view-overview")).toHaveAttribute("aria-current", "page");
  await user.click(screen.getByRole("button", { name: /Plus tard|Later/ }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Ressources|Resources/ })).toHaveAttribute(
      "aria-current",
      "page",
    ),
  );
  expect(setup.navigate).not.toHaveBeenCalled();
  expect(useSelectionStore.getState().ids.size).toBe(0);
});
