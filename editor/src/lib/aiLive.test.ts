import { describe, expect, it } from "vitest";
import { liveWrites, partialStringFields } from "./aiLive";

describe("live tool input", () => {
  it("reads the string fields written so far, the last one cut", () => {
    expect(
      partialStringFields(
        '{"project":"u-local.shop","path":"menus/vip.yml","content":"title: \\"V',
      ),
    ).toEqual({ project: "u-local.shop", path: "menus/vip.yml", content: 'title: "V' });
    expect(partialStringFields('{"path":"menus/a.yml","delete":true,"content":"a\\nb"}')).toEqual({
      path: "menus/a.yml",
      content: "a\nb",
    });
    expect(partialStringFields('{"content":"line\\')).toEqual({ content: "line" });
    expect(partialStringFields('{"content":"caf\\u00e')).toEqual({ content: "caf" });
    expect(partialStringFields('{"content":"caf\\u00e9"}')).toEqual({ content: "café" });
    expect(partialStringFields('{"pro')).toEqual({});
  });

  it("keeps only the files being written", () => {
    expect(
      liveWrites([
        { id: "1", name: "read_document", input: '{"path":"a.yml"}' },
        { id: "2", name: "write_document", input: '{"project":"u-local.shop","path":"menus/b' },
      ]),
    ).toEqual([{ id: "2", project: "u-local.shop", path: "menus/b", content: "" }]);
  });
});
