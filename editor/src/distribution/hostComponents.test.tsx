import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";
import { hostComponents } from "./hostComponents";

const { MiniMessageInput } = hostComponents;

function Controlled() {
  const [value, setValue] = useState("Grade : ");
  return (
    <>
      <MiniMessageInput
        value={value}
        onChange={setValue}
        variables={[{ path: "rank", sample: "Officier" }]}
        aria-label="t"
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

it("offers a module's variables as Artisan's own fields offer theirs", async () => {
  render(<Controlled />);
  fireEvent.focus(document.querySelector(".cm-content") as HTMLElement);
  fireEvent.click(screen.getByRole("button", { name: /Bibliothèque/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Rank/ }));
  expect(screen.getByTestId("value").textContent).toBe("Grade : {rank}");
});
