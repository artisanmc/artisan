import { type ReactElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ActionChainEditor,
  type EditorHost,
  ItemInput,
  MaterialInput,
  MiniMessageInput,
  SortableList,
  installEditorHost,
} from "./host";

describe("host components", () => {
  it("render the editor's own widgets with the module's props", () => {
    installEditorHost({
      components: {
        ActionChainEditor: ({ value }) => createElement("i", null, `chain:${value.length}`),
        MaterialInput: ({ value }) => createElement("b", null, `material:${value}`),
        MiniMessageInput: ({ value }) => createElement("s", null, `mm:${value}`),
        SortableList: ({ ids, children }) =>
          createElement(
            "ol",
            null,
            ids.map((id, i) => createElement("li", { key: id }, children(i, createElement("hr")))),
          ),
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
        createElement(
          SortableList,
          { key: "s", ids: ["a", "b"], onMove: () => {} },
          (index: number, handle: ReactElement) =>
            createElement("span", null, handle, `row${index}`),
        ),
      ]),
    );
    expect(html).toBe(
      "<div><i>chain:1</i><b>material:STONE</b><u>item:FISHING_ROD:material,enchants</u><s>mm:&lt;red&gt;Hi</s>" +
        "<ol><li><span><hr/>row0</span></li><li><span><hr/>row1</span></li></ol></div>",
    );
  });
});
