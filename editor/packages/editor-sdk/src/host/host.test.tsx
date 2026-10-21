import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ActionChainEditor,
  type EditorHost,
  ItemInput,
  MaterialInput,
  MiniMessageInput,
  installEditorHost,
} from "./host";

describe("host components", () => {
  it("render the editor's own widgets with the module's props", () => {
    installEditorHost({
      components: {
        ActionChainEditor: ({ value }) => createElement("i", null, `chain:${value.length}`),
        MaterialInput: ({ value }) => createElement("b", null, `material:${value}`),
        MiniMessageInput: ({ value }) => createElement("s", null, `mm:${value}`),
        ItemInput: ({ value, match }) =>
          createElement(
            "u",
            null,
            `item:${String(value.material)}:${match?.join(",") ?? "default"}`,
          ),
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
        createElement(ItemInput, {
          key: "i",
          projectId: "p",
          value: { material: "FISHING_ROD" },
          match: ["material", "enchants"],
          onChange: () => {},
        }),
        createElement(MiniMessageInput, { key: "t", value: "<red>Hi", onChange: () => {} }),
      ]),
    );
    expect(html).toBe(
      "<div><i>chain:1</i><b>material:STONE</b><u>item:FISHING_ROD:material,enchants</u><s>mm:&lt;red&gt;Hi</s></div>",
    );
  });
});
