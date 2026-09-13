import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";
import { beforeEach, expect, it, vi } from "vitest";
import { buildZip } from "./buildZip";
import { useProjectZipImport } from "./useProjectZipImport";
beforeEach(async () => {
  await i18n.changeLanguage("en");
});

it("asks for the destination of a rootless archive before importing", async () => {
  const file = await buildZip({ "manifest.yaml": "schema: manifest/v1\nproject_id: old_id\n" });
  const importProject = vi.fn(() => "new-internal-id");
  const onImported = vi.fn();
  function Harness() {
    const { importFile, dialog } = useProjectZipImport({
      importProject,
      onImported,
      onError: vi.fn(),
    });
    return (
      <>
        <button type="button" onClick={() => importFile(file)}>
          Choose ZIP
        </button>
        {dialog}
      </>
    );
  }
  render(<Harness />);
  fireEvent.click(screen.getByText("Choose ZIP"));
  const input = await screen.findByLabelText("Project folder");
  expect(importProject).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "my_demo" } });
  fireEvent.click(screen.getByRole("button", { name: "Import project" }));
  await waitFor(() =>
    expect(importProject).toHaveBeenCalledWith({
      project: expect.objectContaining({ id: "my_demo" }),
    }),
  );
  expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ newId: "new-internal-id" }));
});
