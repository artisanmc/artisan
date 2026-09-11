import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AssistantMarkdown } from "./AssistantMarkdown";

afterEach(cleanup);

it("renders GFM tables, links and inline code", () => {
  render(
    <AssistantMarkdown>
      {
        "| Menu | State |\n| --- | --- |\n| Shop | Ready |\n\n[Docs](https://example.com) and `menu.yml`"
      }
    </AssistantMarkdown>,
  );
  expect(screen.getByRole("table")).toHaveTextContent("Shop");
  expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "https://example.com");
  expect(screen.getByText("menu.yml").tagName).toBe("CODE");
});

it("does not interpret raw HTML or unsafe link protocols", () => {
  const { container } = render(
    <AssistantMarkdown>
      {"<script>alert(1)</script>\n\n[Unsafe](javascript:alert%281%29)"}
    </AssistantMarkdown>,
  );
  expect(container.querySelector("script")).toBeNull();
  expect(screen.getByText("Unsafe")).not.toHaveAttribute(
    "href",
    expect.stringContaining("javascript:"),
  );
});

it("updates incomplete Markdown as the answer arrives", () => {
  const view = render(<AssistantMarkdown>{"**Work"}</AssistantMarkdown>);
  expect(screen.getByText("**Work")).toBeVisible();
  view.rerender(<AssistantMarkdown>{"**Working**"}</AssistantMarkdown>);
  expect(screen.getByText("Working").tagName).toBe("STRONG");
});
