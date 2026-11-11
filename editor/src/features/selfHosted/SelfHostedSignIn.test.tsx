import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SelfHostedSignIn } from "./SelfHostedSignIn";

describe("SelfHostedSignIn", () => {
  it("points to the in-game command", () => {
    render(<SelfHostedSignIn expired={false} />);
    expect(screen.getByText("/artisan editor")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when the link was already used", () => {
    render(<SelfHostedSignIn expired />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
