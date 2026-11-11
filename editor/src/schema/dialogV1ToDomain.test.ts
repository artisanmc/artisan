import { projectId } from "@/domain/ids";
import { describe, expect, it } from "vitest";
import { dialogV1ToDomain } from "./dialogV1ToDomain";

const opts = { projectId: projectId("p1"), lang: "en" };

describe("dialogV1ToDomain", () => {
  it("maps title, escape default true, and a text button action → steps", () => {
    const { dialog, i18nKeys } = dialogV1ToDomain(
      {
        schema: "dialog/v1",
        id: "confirm",
        title: "Sure?",
        buttons: [{ id: "yes", label: "Yes", actions: "close_dialog" }],
      },
      opts,
    );
    expect(dialog.id).toBe("confirm");
    expect(dialog.projectId).toBe("p1");
    expect(dialog.canCloseWithEscape).toBe(true);
    expect(i18nKeys[dialog.title.key]).toEqual({ en: "Sure?" });
    expect(dialog.buttons[0]!.steps).toEqual([
      { kind: "action", action: { name: "close_dialog", value: null } },
    ]);
    expect(i18nKeys[dialog.buttons[0]!.label.key]).toEqual({ en: "Yes" });
  });

  it("maps can_close_with_escape:false, body text+item, and a text input", () => {
    const { dialog } = dialogV1ToDomain(
      {
        schema: "dialog/v1",
        id: "d",
        title: "{i18n:dialogs.d.title}",
        can_close_with_escape: false,
        body: [
          { type: "text", text: "Hello" },
          { type: "item", material: "DIAMOND", count: 3 },
        ],
        inputs: [{ id: "name", type: "text", label: "Name", default: "x", max_length: 16 }],
        buttons: [{ id: "ok", label: "OK" }],
      },
      opts,
    );
    expect(dialog.canCloseWithEscape).toBe(false);
    expect(dialog.body[0]).toMatchObject({ type: "text" });
    expect(dialog.body[1]).toEqual({ type: "item", material: "DIAMOND", count: 3 });
    expect(dialog.inputs[0]).toMatchObject({
      type: "text",
      id: "name",
      default: "x",
      maxLength: 16,
    });
    expect(dialog.buttons[0]!.steps).toEqual([]);
  });

  it("maps single_option input options + bool/number_range defaults", () => {
    const { dialog } = dialogV1ToDomain(
      {
        schema: "dialog/v1",
        id: "d",
        title: "t",
        inputs: [
          { id: "b", type: "bool", label: "B", default: "true" },
          { id: "n", type: "number_range", label: "N", min: 0, max: 10, default: "5" },
          {
            id: "o",
            type: "single_option",
            label: "O",
            options: [{ value: "a", label: "A" }],
            default: "a",
          },
        ],
        buttons: [{ id: "ok", label: "OK" }],
      },
      opts,
    );
    expect(dialog.inputs[0]).toMatchObject({ type: "bool", default: true });
    expect(dialog.inputs[1]).toMatchObject({ type: "number_range", min: 0, max: 10, default: 5 });
    const opt = dialog.inputs[2] as any;
    expect(opt.type).toBe("single_option");
    expect(opt.options[0].value).toBe("a");
  });

  it("drops an unknown input type and flags it, instead of coercing to text", () => {
    const { dialog, unsupported } = dialogV1ToDomain(
      {
        schema: "dialog/v1",
        id: "d",
        title: "t",
        inputs: [
          { id: "c", type: "color_picker", label: "C" },
          { id: "ok", type: "text", label: "OK", default: "", max_length: 8 },
        ],
        buttons: [{ id: "ok", label: "OK" }],
      },
      opts,
    );
    expect(dialog.inputs).toHaveLength(1);
    expect(dialog.inputs[0]!.id).toBe("ok");
    expect(unsupported).toContain("input type: color_picker");
  });

  it("drops an unknown body type and flags it", () => {
    const { dialog, unsupported } = dialogV1ToDomain(
      {
        schema: "dialog/v1",
        id: "d",
        title: "t",
        body: [
          { type: "hologram", data: 1 },
          { type: "text", text: "hi" },
        ],
        buttons: [{ id: "ok", label: "OK" }],
      },
      opts,
    );
    expect(dialog.body).toHaveLength(1);
    expect(dialog.body[0]).toMatchObject({ type: "text" });
    expect(unsupported).toContain("body type: hologram");
  });
});
