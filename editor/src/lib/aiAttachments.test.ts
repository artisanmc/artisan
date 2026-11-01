import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_LIMITS,
  type PendingAttachment,
  attachmentFromBytes,
  attachmentKind,
  fits,
} from "./aiAttachments";

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

describe("assistant attachments", () => {
  it("tells the kind from the bytes, not the name", () => {
    expect(attachmentKind(bytes(0x89, 0x50, 0x4e, 0x47, 13, 10))).toBe("image");
    expect(attachmentKind(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image");
    expect(attachmentKind(text("RIFF\0\0\0\0WEBPVP8 "))).toBe("image");
    expect(attachmentKind(text("%PDF-1.7"))).toBe("pdf");
    expect(attachmentKind(text("name: '&6Boutique'\nitems: {}"))).toBe("text");
    expect(attachmentKind(bytes(0, 1, 2))).toBeNull();
    expect(attachmentKind(bytes(0xc3, 0x28))).toBeNull();
  });

  it("encodes the bytes and refuses what the hub would", () => {
    const yml = attachmentFromBytes("shop.yml", text("é: 1"), {
      project: "u-local.shop",
      path: "menus/shop.yml",
    }) as PendingAttachment;
    expect(yml).toMatchObject({ name: "shop.yml", kind: "text", size: 5, path: "menus/shop.yml" });
    expect(atob(yml.data)).toBe(String.fromCharCode(...text("é: 1")));
    expect(attachmentFromBytes("x.bin", bytes(0, 0))).toBe("ai_attachment_unsupported");
    expect(attachmentFromBytes("big.txt", text("a".repeat(ATTACHMENT_LIMITS.text + 1)))).toBe(
      "ai_attachment_too_large",
    );
  });

  it("keeps a message within its count and size", () => {
    const one = attachmentFromBytes("a.txt", text("a")) as PendingAttachment;
    expect(fits([], one)).toBeNull();
    expect(fits(Array(ATTACHMENT_LIMITS.files).fill(one), one)).toBe("ai_attachment_count");
    const heavy = { ...one, size: ATTACHMENT_LIMITS.message };
    expect(fits([heavy], one)).toBe("ai_attachment_too_large");
  });
});
