/**
 * Files sent to the assistant with a message (ADR `editor-assistant`): uploaded from the player's
 * computer or picked among the server's module files. The editor reads the bytes, the hub checks
 * them again (kind from the bytes, sizes) and passes them to the model.
 */

export type AiAttachmentKind = "image" | "pdf" | "text";

/** A file waiting in the composer, ready to send. */
export interface PendingAttachment {
  /** Local key, for the list. */
  key: string;
  name: string;
  kind: AiAttachmentKind;
  size: number;
  /** The bytes in base64. */
  data: string;
  /** Picked on the server: its module (Project id) and its path there. */
  project?: string;
  path?: string;
}

export type AttachmentRefusal =
  | "ai_attachment_unsupported"
  | "ai_attachment_too_large"
  | "ai_attachment_count";

/** The hub's limits (`AiAttachment`), checked here first so the player learns before sending. */
export const ATTACHMENT_LIMITS = {
  files: 5,
  image: 3_750_000,
  pdf: 6_000_000,
  /** Characters, not bytes. */
  text: 200_000,
  message: 6_000_000,
};

/** Longest side of an image sent: the model sees no more, so a larger one only costs bytes. */
export const IMAGE_MAX_EDGE = 1568;

const starts = (bytes: Uint8Array, prefix: number[]) =>
  bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/** An image or a PDF by its first bytes, text when it is UTF-8 without a NUL; null: neither. */
export function attachmentKind(bytes: Uint8Array): AiAttachmentKind | null {
  if (
    starts(bytes, [0x89, 0x50, 0x4e, 0x47]) ||
    starts(bytes, [0xff, 0xd8, 0xff]) ||
    starts(bytes, ascii("GIF8")) ||
    (starts(bytes, ascii("RIFF")) && starts(bytes.subarray(8), ascii("WEBP")))
  )
    return "image";
  if (starts(bytes, ascii("%PDF-"))) return "pdf";
  if (bytes.includes(0)) return null;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return "text";
  } catch {
    return null;
  }
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

let counter = 0;

/** [bytes] as a file to send, or why it cannot go. */
export function attachmentFromBytes(
  name: string,
  bytes: Uint8Array,
  origin: { project?: string; path?: string } = {},
): PendingAttachment | AttachmentRefusal {
  const kind = attachmentKind(bytes);
  if (!kind) return "ai_attachment_unsupported";
  const size =
    kind === "text" ? new TextDecoder().decode(bytes).replace(/^\uFEFF/, "").length : bytes.length;
  if (size > ATTACHMENT_LIMITS[kind]) return "ai_attachment_too_large";
  counter += 1;
  return {
    key: `a${counter}`,
    name,
    kind,
    size: bytes.length,
    data: base64(bytes),
    ...origin,
  };
}

/**
 * An image larger than the model looks at, drawn again at [IMAGE_MAX_EDGE] in its own format
 * (a PNG keeps its transparency). Anything that fails keeps the original.
 */
async function shrink(file: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height);
    if (scale >= 1) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const smaller = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, file.type, 0.9),
    );
    return smaller && smaller.size < file.size ? smaller : file;
  } catch {
    return file;
  }
}

/** A file the player dropped, pasted or chose on their computer. */
export async function attachmentFromFile(
  file: File,
): Promise<PendingAttachment | AttachmentRefusal> {
  const blob = file.type.startsWith("image/") ? await shrink(file) : file;
  return attachmentFromBytes(file.name || "file", new Uint8Array(await blob.arrayBuffer()));
}

/** Whether [next] still fits beside [current] in one message. */
export function fits(
  current: PendingAttachment[],
  next: PendingAttachment,
): AttachmentRefusal | null {
  if (current.length >= ATTACHMENT_LIMITS.files) return "ai_attachment_count";
  const total = current.reduce((sum, a) => sum + a.size, 0) + next.size;
  return total > ATTACHMENT_LIMITS.message ? "ai_attachment_too_large" : null;
}

/** "12 KB", "1.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
