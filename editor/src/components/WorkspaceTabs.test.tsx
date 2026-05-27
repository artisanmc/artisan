import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkspaceTabs } from "./WorkspaceTabs";

describe("WorkspaceTabs", () => {
  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "translations", label: "Translations", badge: 3 },
    { id: "data-sources", label: "Data Sources" },
  ];

  it("renders all tab labels", () => {
    render(<WorkspaceTabs tabs={tabs} activeTab="overview" onChange={() => {}} />);
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Translations")).toBeInTheDocument();
    expect(screen.getByText("Data Sources")).toBeInTheDocument();
  });

  it("renders a badge when provided", () => {
    render(<WorkspaceTabs tabs={tabs} activeTab="overview" onChange={() => {}} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("marks the active tab with aria-current=page", () => {
    render(<WorkspaceTabs tabs={tabs} activeTab="translations" onChange={() => {}} />);
    const activeBtn = screen.getByText("Translations").closest("button");
    expect(activeBtn).toHaveAttribute("aria-current", "page");
  });

  it("calls onChange with the tab id when clicked", () => {
    const onChange = vi.fn();
    render(<WorkspaceTabs tabs={tabs} activeTab="overview" onChange={onChange} />);
    fireEvent.click(screen.getByText("Translations"));
    expect(onChange).toHaveBeenCalledWith("translations");
  });
});
