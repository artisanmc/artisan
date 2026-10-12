// @vitest-environment node

import { constants, deflateSync } from "node:zlib";
import { unzlibSync } from "fflate";
import { describe, expect, test } from "vitest";
import { deflateRle } from "./deflateRle";

// Les options de pngjs 7 pour ses IDAT.
const zlibRle = (data: Uint8Array) =>
  new Uint8Array(deflateSync(data, { level: 9, strategy: constants.Z_RLE, chunkSize: 32 * 1024 }));

function sample(length: number, kind: number, seed: number): Uint8Array {
  let state = seed;
  const rand = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  const out = new Uint8Array(length);
  let run = 0;
  for (let i = 0; i < length; i++) {
    if (kind === 0)
      out[i] = rand() * 256; // bruit : blocs stockés
    else if (kind === 1) {
      if (rand() < 0.05) run = rand() * 256;
      out[i] = run; // longues plages : arbres dynamiques
    } else out[i] = rand() < 0.5 ? 0 : rand() * 4; // peu de symboles : arbres fixes
  }
  return out;
}

describe("deflateRle", () => {
  test("matches zlib Z_RLE level 9 byte for byte", () => {
    const inputs: Uint8Array[] = [
      new Uint8Array([1]),
      new Uint8Array(4),
      new Uint8Array(300_000), // fenêtre qui glisse
      new Uint8Array(16_383 * 3), // bloc final vide
    ];
    for (let n = 0; n < 30; n++) inputs.push(sample(1 + ((n * 7717) % 9000), n % 3, n + 1));
    inputs.push(sample(200_000, 0, 42), sample(200_000, 1, 43), sample(200_000, 2, 44));
    for (const input of inputs) expect(deflateRle(input)).toEqual(zlibRle(input));
  });

  test("inflates back to the input", () => {
    const input = sample(50_000, 1, 7);
    expect(unzlibSync(deflateRle(input))).toEqual(input);
  });
});
