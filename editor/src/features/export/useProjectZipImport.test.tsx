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

it("offers to rename or overwrite when the folder is already taken", async () => {
  const file = await buildZip({ "manifest.yaml": "schema: manifest/v1\n" });
  const persistImport = vi
    .fn()
    .mockRejectedValueOnce(new Error("destination_exists"))
    .mockResolvedValue({ newId: "existing", urlId: "main", name: "main" });
  const onImported = vi.fn();
  const onError = vi.fn();
  function Harness() {
    const { importFile, dialog } = useProjectZipImport({
      importProject: vi.fn(),
      persistImport,
      destinationDescription: "Import as a hosted project.",
      onImported,
      onError,
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
  fireEvent.change(await screen.findByLabelText("Project folder"), { target: { value: "main" } });
  fireEvent.click(screen.getByRole("button", { name: "Import project" }));
  expect(await screen.findByText(/already exists/)).toBeTruthy();
  expect(onError).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Project folder") as HTMLInputElement).value).toBe("main_2");
  fireEvent.click(screen.getByRole("button", { name: /Overwrite/ }));
  await waitFor(() =>
    expect(persistImport).toHaveBeenLastCalledWith(file, "main", { overwrite: true }),
  );
  expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ newId: "existing" }));
});
