import type { IncomingMessage, ServerResponse } from "node:http";

export function createWikiMiddleware(
  directory: string,
): (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => Promise<void>;
