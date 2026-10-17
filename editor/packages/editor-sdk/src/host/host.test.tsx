import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActionChainEditor, type EditorHost, MaterialInput, installEditorHost } from "./host";

describe("host components", () => {
  it("render the editor's own widgets with the module's props", () => {
    installEditorHost({
      components: {
        ActionChainEditor: ({ value }) => createElement("i", null, `chain:${value.length}`),
        MaterialInput: ({ value }) => createElement("b", null, `material:${value}`),
      },
    } as unknown as EditorHost);
    const html = renderToStaticMarkup(
      createElement("div", null, [
        createElement(ActionChainEditor, {
          key: "a",
          projectId: "p",
          value: [{ message: "hi" }],
          onChange: () => {},
        }),
        createElement(MaterialInput, { key: "m", value: "STONE", onChange: () => {} }),
      ]),
    );
    expect(html).toBe("<div><i>chain:1</i><b>material:STONE</b></div>");
  });
});
