import type { Project } from "@/domain/types";
import { editorTourController } from "@/features/onboarding/editorTourRuntime";
import { useTourPresentation } from "@/features/onboarding/tourPresentation";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useSelectionStore } from "@/state/selectionStore";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectCanvasPage } from "./ProjectWorkspace";
import { useProjectLibraryStore } from "./projectLibraryStore";

const tour = vi.hoisted(() => ({
  progress: null as { step: number; completed: boolean } | null,
}));
vi.mock("@/lib/api/auth", () => ({
  getMe: async () => ({ id: "u1", editorTour: tour.progress }),
  patchMe: async ({
    editor_tour: action,
  }: { editor_tour: { action: string; step?: number } }) => {
    const started = action.action === "start" && !tour.progress;
    if (action.action === "start") tour.progress ??= { step: 0, completed: false };
    if (action.action === "progress") tour.progress = { step: action.step!, completed: false };
    if (action.action === "complete") tour.progress = { step: 6, completed: true };
    return { user: { id: "u1", editorTour: tour.progress }, tourStarted: started };
  },
}));
const setup = vi.hoisted(() => ({
  ready: true,
  tab: "overview",
  navigate: vi.fn(),
  project: null as Project | null,
  offline: false,
  stale: false,
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
    offline: setup.offline,
    stale: setup.stale,
    error: null,
    fromDraft: false,
  }),
}));
vi.mock("@/components/LinkedServersDropdown", () => ({ LinkedServersDropdown: () => null }));
vi.mock("@/features/canvas/Stage", () => ({ Stage: () => <div>Demo canvas</div> }));
vi.mock("@/features/canvas/useTextureInit", () => ({ useTextureInit: () => {} }));
vi.mock("@/features/assets/useAssetInit", () => ({ useAssetInit: () => {} }));
vi.mock("@/features/canvas/EditorPane", () => ({ EditorPane: () => null }));
vi.mock("@/features/assets/AssetsTab", () => ({ AssetsTab: () => <div>Resource library</div> }));
vi.mock("@/features/translations/TranslationPanel", () => ({
  TranslationPanelContent: () => null,
}));
vi.mock("@/features/data/DataSourcesPanel", () => ({ DataSourcesPanelContent: () => null }));
vi.mock("@/features/help/PatternsGallery", () => ({ PatternsGallery: () => null }));
vi.mock("@/features/search/SearchPalette", () => ({ SearchPalette: () => null }));
vi.mock("@/lib/useMediaQuery", () => ({ useIsDesktop: () => true }));

beforeEach(() => {
  localStorage.clear();
  editorTourController.deactivate();
  tour.progress = null;
  useAuthStore.setState({ currentUser: { id: "u1" } as never, isLoading: false });
  useSelectionStore.getState().clear();
  useProjectLibraryStore.getState().close();
  useTourPresentation.setState({ step: null });
  setup.ready = true;
  setup.offline = false;
  setup.stale = false;
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

it("starts only after a resolved workspace, then resumes from its real project menu", async () => {
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
    await screen.findByRole("dialog", {
      name: /Vos projets au même endroit|Your projects, in one place/,
    }),
  ).toBeInTheDocument();
  // Paced by the tour's real delays (~2.3 s alone): 5 s is not enough under load.
}, 15_000);

it("replays the tour on a project whose server is offline", async () => {
  // The tour does not depend on the Minecraft server: an offline server made
  // "Restart the tour" do nothing.
  const user = userEvent.setup();
  tour.progress = { step: 6, completed: true };
  setup.offline = true;
  setup.stale = true;
  render(<ProjectCanvasPage projectRef="p1" />);
  await act(async () => {});
  expect(screen.queryByRole("dialog")).toBeNull();
  await user.click(screen.getByRole("button", { name: /Plus d'actions|More actions/ }));
  await user.click(screen.getByRole("menuitem", { name: /Refaire la visite|Take the tour again/ }));
  expect(
    await screen.findByRole("dialog", { name: /Découvrir Artisan|Discover Artisan/ }),
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
