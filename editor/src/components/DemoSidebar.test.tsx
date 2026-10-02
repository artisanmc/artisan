import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useParams: () => ({ projectId: "demo" }),
  Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

import { DemoSidebar } from "./DemoSidebar";

beforeEach(() => {
  navigate.mockReset();
  useUiStore.setState({ centerRequest: null });
  useAccountStore.setState({
    account: {
      id: "",
      projectOrder: [],
      projects: [
        {
          id: "demo",
          name: "Welcome",
          defaultLang: "fr",
          i18nKeys: {},
          menus: [{ id: "accueil", rows: 3, layers: [], title: [] }],
          commands: [],
          dialogs: [],
        },
      ],
    },
  } as never);
});

it("lists the demo project's documents, since the demo has no server list", () => {
  render(<DemoSidebar />);
  expect(screen.getByRole("group", { name: /Welcome/ })).toHaveTextContent("accueil");
});

it("centres the canvas on a picked document, on the demo route", () => {
  render(<DemoSidebar />);
  fireEvent.click(screen.getByText("accueil"));
  expect(useUiStore.getState().centerRequest).toMatchObject({ docId: "accueil" });
  expect(navigate).toHaveBeenCalledWith(
    expect.objectContaining({ to: "/demo/projects/$projectId" }),
  );
});
