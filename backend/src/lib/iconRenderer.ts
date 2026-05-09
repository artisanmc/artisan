/**
 * Minecraft item/block icon renderer.
 *
 * renderFromElements: full 3D pipeline with display.gui transform, back-face culling,
 *   orthographic projection, and triangle rasterisation.
 * renderIsometricIcon: fast path for plain cube blocks (top + side textures only).
 */

import { PNG } from "pngjs";
import { readFileSync } from "fs";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ModelFace {
  texture: string;
  uv?: [number, number, number, number];
  rotation?: number;
}

export interface ModelElement {
  from: [number, number, number];
  to: [number, number, number];
  rotation?: {
    origin: [number, number, number];
    // standard Minecraft format (single axis)
    axis?: "x" | "y" | "z";
    angle?: number;
    // BlockBench multi-axis format
    x?: number;
    y?: number;
    z?: number;
    rescale?: boolean;
  };
  faces?: Partial<Record<"up" | "down" | "north" | "south" | "west" | "east", ModelFace>>;
}

export interface GuiDisplay {
  rotation?: [number, number, number];
  translation?: [number, number, number];
  scale?: [number, number, number];
}

// ── Math ──────────────────────────────────────────────────────────────────────

type Vec3 = [number, number, number];

function d2r(d: number): number { return d * Math.PI / 180; }

function rotAxis(v: Vec3, axis: "x" | "y" | "z", deg: number): Vec3 {
  const a = d2r(deg), c = Math.cos(a), s = Math.sin(a);
  const [x, y, z] = v;
  if (axis === "x") return [x, c * y - s * z, s * y + c * z];
  if (axis === "y") return [c * x + s * z, y, -s * x + c * z];
  return [c * x - s * y, s * x + c * y, z];
}

function applyElemRotation(v: Vec3, rot: ModelElement["rotation"]): Vec3 {
  if (!rot) return v;
  const [ox, oy, oz] = rot.origin;
  let p: Vec3 = [v[0] - ox, v[1] - oy, v[2] - oz];
  if (rot.axis && rot.angle != null) {
    p = rotAxis(p, rot.axis, rot.angle);
  } else {
    if (rot.x) p = rotAxis(p, "x", rot.x);
    if (rot.y) p = rotAxis(p, "y", rot.y);
    if (rot.z) p = rotAxis(p, "z", rot.z);
  }
  return [p[0] + ox, p[1] + oy, p[2] + oz];
}

// Rotate normal by element rotation (no translation component)
function rotateNormalByElem(n: Vec3, rot: ModelElement["rotation"]): Vec3 {
  if (!rot) return n;
  let r = n;
  if (rot.axis && rot.angle != null) {
    r = rotAxis(r, rot.axis, rot.angle);
  } else {
    if (rot.x) r = rotAxis(r, "x", rot.x);
    if (rot.y) r = rotAxis(r, "y", rot.y);
    if (rot.z) r = rotAxis(r, "z", rot.z);
  }
  return r;
}

// Apply gui display transform: center at (8,8,8), scale, rotateYXZ, translate.
// Minecraft's GUI Y-rotation follows the left-hand (clockwise-from-above) convention,
// so we negate the Y angle to convert to our right-hand rotAxis.
function applyGuiXform(v: Vec3, rot: Vec3, scale: Vec3, trans: Vec3): Vec3 {
  let [x, y, z]: Vec3 = [
    (v[0] - 8) * scale[0],
    (v[1] - 8) * scale[1],
    (v[2] - 8) * scale[2],
  ];
  [x, y, z] = rotAxis([x, y, z], "y", -rot[1]);
  [x, y, z] = rotAxis([x, y, z], "x", rot[0]);
  [x, y, z] = rotAxis([x, y, z], "z", rot[2]);
  return [x + trans[0], y + trans[1], z + trans[2]];
}

// ── Face geometry ─────────────────────────────────────────────────────────────

const FACE_NORMALS: Record<string, Vec3> = {
  up: [0, 1, 0], down: [0, -1, 0],
  north: [0, 0, -1], south: [0, 0, 1],
  west: [-1, 0, 0], east: [1, 0, 0],
};

// Directional brightness for gui_light:"side" mode
const FACE_BRIGHTNESS: Record<string, number> = {
  up: 1.0, down: 0.5, north: 0.8, south: 0.8, west: 0.6, east: 0.6,
};

// 4 corners in UV order: [0]=(u0,v0), [1]=(u1,v0), [2]=(u1,v1), [3]=(u0,v1)
// These orderings match Minecraft's default UV mapping for each face.
function faceCorners(face: string, [x0, y0, z0]: Vec3, [x1, y1, z1]: Vec3): Vec3[] {
  switch (face) {
    case "up":    return [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
    case "down":  return [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]];
    case "north": return [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]];
    case "south": return [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]];
    case "west":  return [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]];
    case "east":  return [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]];
    default: return [];
  }
}

// Default UV when the model face does not specify one
function defaultUv(
  face: string,
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
): [number, number, number, number] {
  switch (face) {
    case "up":    return [x0, z0, x1, z1];
    case "down":  return [x0, z1, x1, z0];
    case "north": return [16 - x1, 16 - y1, 16 - x0, 16 - y0];
    case "south": return [x0, 16 - y1, x1, 16 - y0];
    case "west":  return [z0, 16 - y1, z1, 16 - y0];
    case "east":  return [16 - z1, 16 - y1, 16 - z0, 16 - y0];
    default:      return [0, 0, 16, 16];
  }
}

function rotateUv(u: number, v: number, rotation: number): [number, number] {
  const c = 8, du = u - c, dv = v - c;
  switch (rotation) {
    case  90: return [c + dv, c - du];
    case 180: return [c - du, c - dv];
    case 270: return [c - dv, c + du];
    default:  return [u, v];
  }
}

// ── Texture sampling ──────────────────────────────────────────────────────────

function clamp(v: number): number { return v < 0 ? 0 : v > 255 ? 255 : v; }

// u, v are in Minecraft UV space [0,16]. Handles any texture resolution.
function sampleTex(png: PNG, u: number, v: number): [number, number, number, number] {
  const W = png.width, H = png.height;
  const tx = (((Math.floor(u * W / 16)) % W) + W) % W;
  const ty = (((Math.floor(v * H / 16)) % H) + H) % H;
  const i = (ty * W + tx) * 4;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!, png.data[i + 3]!];
}

// ── Triangle rasteriser ───────────────────────────────────────────────────────

type Vert = { sx: number; sy: number; sz: number; u: number; v: number };

function rasterizeTri(
  out: PNG, depthBuf: Float32Array, W: number, H: number,
  a: Vert, b: Vert, c: Vert,
  tex: PNG, brightness: number,
): void {
  const x0 = Math.max(0, Math.floor(Math.min(a.sx, b.sx, c.sx)));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(a.sx, b.sx, c.sx)));
  const y0 = Math.max(0, Math.floor(Math.min(a.sy, b.sy, c.sy)));
  const y1 = Math.min(H - 1, Math.ceil(Math.max(a.sy, b.sy, c.sy)));

  const denom = (b.sy - c.sy) * (a.sx - c.sx) + (c.sx - b.sx) * (a.sy - c.sy);
  if (Math.abs(denom) < 1e-6) return;
  const inv = 1 / denom;

  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const cx = px + 0.5, cy = py + 0.5;
      const w0 = ((b.sy - c.sy) * (cx - c.sx) + (c.sx - b.sx) * (cy - c.sy)) * inv;
      const w1 = ((c.sy - a.sy) * (cx - c.sx) + (a.sx - c.sx) * (cy - c.sy)) * inv;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;

      const dz = w0 * a.sz + w1 * b.sz + w2 * c.sz;
      const pi = py * W + px;
      // Larger Z = closer to camera (camera at +Z looking in -Z direction)
      if (dz <= depthBuf[pi]!) continue;

      const u = w0 * a.u + w1 * b.u + w2 * c.u;
      const v = w0 * a.v + w1 * b.v + w2 * c.v;
      const [r, g, bl, al] = sampleTex(tex, u, v);
      if (al === 0) continue; // transparent: don't update depth

      depthBuf[pi] = dz;
      const oi = pi * 4;
      out.data[oi]     = clamp(Math.round(r  * brightness));
      out.data[oi + 1] = clamp(Math.round(g  * brightness));
      out.data[oi + 2] = clamp(Math.round(bl * brightness));
      out.data[oi + 3] = al;
    }
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

// Default display used when model has no display.gui
const DEFAULT_DISPLAY: Required<GuiDisplay> = {
  rotation: [30, 225, 0],
  scale: [0.625, 0.625, 0.625],
  translation: [0, 0, 0],
};

/**
 * Render a 128×128 RGBA icon from model elements.
 *
 * @param elements   Model element array (from the resolved model JSON)
 * @param textureMap Resolved texture key → PNG
 * @param display    GUI display transform (rotation/scale/translation). Falls back to
 *                   [30,225,0] / [0.625,0.625,0.625] when absent.
 * @param guiLight   "front" = uniform lighting; "side" = directional (default "side")
 */
export function renderFromElements(
  elements: ModelElement[],
  textureMap: Map<string, PNG>,
  display?: GuiDisplay,
  guiLight: "front" | "side" = "side",
): Buffer {
  const W = 128, H = 128;

  const rot   = display?.rotation    ?? DEFAULT_DISPLAY.rotation;
  const scale = display?.scale       ?? DEFAULT_DISPLAY.scale;
  const trans = display?.translation ?? DEFAULT_DISPLAY.translation;

  // ── Pass 1: bounding box for auto-fit ──────────────────────────────────────
  let minSX = Infinity, maxSX = -Infinity;
  let minSY = Infinity, maxSY = -Infinity;

  for (const elem of elements) {
    for (const face of Object.keys(elem.faces ?? {})) {
      for (const corner of faceCorners(face, elem.from as Vec3, elem.to as Vec3)) {
        const p = applyGuiXform(applyElemRotation(corner, elem.rotation), rot, scale, trans);
        const sx = p[0], sy = -p[1];
        if (sx < minSX) minSX = sx; if (sx > maxSX) maxSX = sx;
        if (sy < minSY) minSY = sy; if (sy > maxSY) maxSY = sy;
      }
    }
  }

  const out = new PNG({ width: W, height: H });
  out.data = Buffer.alloc(W * H * 4, 0);
  if (!isFinite(minSX)) return PNG.sync.write(out);

  const MARGIN = 4;
  const spanX = (maxSX - minSX) || 1;
  const spanY = (maxSY - minSY) || 1;
  const ppu = Math.min((W - 2 * MARGIN) / spanX, (H - 2 * MARGIN) / spanY);
  const offX = W / 2 - ((minSX + maxSX) / 2) * ppu;
  const offY = H / 2 - ((minSY + maxSY) / 2) * ppu;

  // Depth buffer: larger value = closer to camera (+Z direction)
  const depthBuf = new Float32Array(W * H).fill(-Infinity);

  // ── Pass 2: rasterise ──────────────────────────────────────────────────────
  for (const elem of elements) {
    const from = elem.from as Vec3, to = elem.to as Vec3;

    for (const [faceName, faceData] of Object.entries(elem.faces ?? {}) as [string, ModelFace][]) {
      if (!faceData) continue;
      const rawNormal = FACE_NORMALS[faceName];
      if (!rawNormal) continue;

      // Transform normal through element rotation → gui rotation, then back-face cull.
      // Negate Y for Minecraft's clockwise GUI convention (matches applyGuiXform).
      let tn = rotateNormalByElem(rawNormal, elem.rotation);
      tn = rotAxis(tn, "y", -rot[1]);
      tn = rotAxis(tn, "x", rot[0]);
      tn = rotAxis(tn, "z", rot[2]);
      if (tn[2] <= 0) continue; // facing away from camera at +Z

      const texKey = faceData.texture.replace(/^#/, "").replace(/^minecraft:/, "");
      const tex = textureMap.get(texKey);
      if (!tex) continue;

      const [u0, v0, u1, v1] = faceData.uv ??
        defaultUv(faceName, from[0], from[1], from[2], to[0], to[1], to[2]);

      const uvs: [number, number][] = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
      if (faceData.rotation) {
        for (let i = 0; i < 4; i++) {
          uvs[i] = rotateUv(uvs[i]![0], uvs[i]![1], faceData.rotation);
        }
      }

      const brightness = guiLight === "front" ? 1.0 : (FACE_BRIGHTNESS[faceName] ?? 0.8);

      const verts: Vert[] = faceCorners(faceName, from, to).map((c, i) => {
        const p = applyGuiXform(applyElemRotation(c, elem.rotation), rot, scale, trans);
        return {
          sx: p[0] * ppu + offX,
          sy: -p[1] * ppu + offY,
          sz: p[2],
          u: uvs[i]![0],
          v: uvs[i]![1],
        };
      });

      // Rasterise as two triangles
      rasterizeTri(out, depthBuf, W, H, verts[0]!, verts[1]!, verts[2]!, tex, brightness);
      rasterizeTri(out, depthBuf, W, H, verts[0]!, verts[2]!, verts[3]!, tex, brightness);
    }
  }

  return PNG.sync.write(out);
}

// ── Simple cube fast path ─────────────────────────────────────────────────────

function readTexture(filePath: string): PNG {
  return PNG.sync.read(readFileSync(filePath));
}

function sample(data: Buffer, width: number, height: number, u: number, v: number): [number, number, number, number] {
  const x = ((Math.floor(u) % width) + width) % width;
  const y = ((Math.floor(v) % height) + height) % height;
  const i = (y * width + x) * 4;
  return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
}

export function renderIsometricIcon(topPath: string, sidePath: string = topPath): Buffer {
  const topPng  = readTexture(topPath);
  const sidePng = topPath === sidePath ? topPng : readTexture(sidePath);

  const W = 128, H = 128;
  const S = W / 32; // scale factor: 4 pixels per old unit
  const out = new PNG({ width: W, height: H });
  out.data = Buffer.alloc(W * H * 4, 0);

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const oi = (py * W + px) * 4;

      // Map back to 32-pixel coordinate space for UV math
      const rx = px / S, ry = py / S;
      const u_t = (rx - 2 * ry + 16) / 2;
      const v_t = (rx + 2 * ry - 16) / 2;
      if (u_t >= 0 && u_t < 16 && v_t >= 0 && v_t < 16) {
        const [r, g, b, a] = sample(topPng.data, topPng.width, topPng.height, u_t, v_t);
        out.data[oi]     = r!; out.data[oi + 1] = g!;
        out.data[oi + 2] = b!; out.data[oi + 3] = a!;
        continue;
      }
      if (rx < 16) {
        const u_l = rx, v_l = ry - rx / 2 - 8;
        if (u_l >= 0 && u_l < 16 && v_l >= 0 && v_l < 16) {
          const [r, g, b, a] = sample(sidePng.data, sidePng.width, sidePng.height, u_l, v_l);
          out.data[oi]     = clamp(Math.round(r! * 0.65));
          out.data[oi + 1] = clamp(Math.round(g! * 0.65));
          out.data[oi + 2] = clamp(Math.round(b! * 0.65));
          out.data[oi + 3] = a!;
          continue;
        }
      }
      if (rx >= 16) {
        const u_r = rx - 16, v_r = ry + (rx - 16) / 2 - 16;
        if (u_r >= 0 && u_r < 16 && v_r >= 0 && v_r < 16) {
          const [r, g, b, a] = sample(sidePng.data, sidePng.width, sidePng.height, u_r, v_r);
          out.data[oi]     = clamp(Math.round(r! * 0.80));
          out.data[oi + 1] = clamp(Math.round(g! * 0.80));
          out.data[oi + 2] = clamp(Math.round(b! * 0.80));
          out.data[oi + 3] = a!;
          continue;
        }
      }
    }
  }
  return PNG.sync.write(out);
}
