import { type ReactElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ActionChainEditor,
  ConditionsEditor,
  DocumentRefInput,
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
        ConditionsEditor: ({ value }) => createElement("em", null, `if:${value.length}`),
        DocumentRefInput: ({ kind, value }) => createElement("a", null, `ref:${kind}:${value}`),
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
        createElement(ConditionsEditor, {
          key: "c",
          projectId: "p",
          value: [{ has_permission: "vip" }, { not: { world_is: "nether" } }],
          onChange: () => {},
        }),
        createElement(DocumentRefInput, {
          key: "r",
          projectId: "p",
          kind: "quest_group",
          value: "forge",
          onChange: () => {},
        }),
      ]),
    );
    expect(html).toBe(
      "<div><i>chain:1</i><b>material:STONE</b><u>item:FISHING_ROD:material,enchants</u><s>mm:&lt;red&gt;Hi</s>" +
        "<ol><li><span><hr/>row0</span></li><li><span><hr/>row1</span></li></ol>" +
        "<em>if:2</em><a>ref:quest_group:forge</a></div>",
    );
  });
});
