import * as THREE from "three";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ModelFace {
  texture: string;
  uv?: [number, number, number, number];
  rotation?: number;
  cullface?: string;
}

interface ModelElement {
  from: [number, number, number];
  to: [number, number, number];
  rotation?: { origin: [number, number, number]; axis: "x" | "y" | "z"; angle: number; rescale?: boolean };
  shade?: boolean; // default: true — when false, face brightness is always 1.0
  faces: Partial<Record<"down" | "up" | "north" | "south" | "west" | "east", ModelFace>>;
}

interface DisplayTransform {
  rotation?: [number, number, number];
  translation?: [number, number, number];
  scale?: [number, number, number];
}

export interface ResolvedModel {
  elements: ModelElement[];
  textures: Record<string, string>;
  display?: DisplayTransform;
  guiLight: "front" | "side";
}

// ── Singleton renderer + camera ────────────────────────────────────────────────

let _renderer: THREE.WebGLRenderer | null = null;
let _camera: THREE.OrthographicCamera | null = null;

function getRenderer(): THREE.WebGLRenderer {
  if (!_renderer) {
    _renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    _renderer.setSize(256, 256);
    _renderer.setClearColor(0x000000, 0);
  }
  return _renderer;
}

function getCamera(): THREE.OrthographicCamera {
  if (!_camera) {
    // Model space: 0-16 units per block, centered at (8,8,8) → group offset to origin.
    // Camera sees ±10 units to give margin around the 8-unit radius of a full block.
    _camera = new THREE.OrthographicCamera(-8, 8, 8, -8, 0.1, 200);
    _camera.position.set(0, 0, 100);
    _camera.lookAt(0, 0, 0);
  }
  return _camera;
}

// ── Caches ─────────────────────────────────────────────────────────────────────

const renderCache = new Map<string, Promise<string | null>>();

// Pre-resolved models loaded in one shot from /api/v1/model-bundle — eliminates
// per-item HTTP round-trips for model JSON + parent chain resolution.
const resolvedModelCache = new Map<string, ResolvedModel>();

function cacheKey(modelPath: string, version: string, isCustom: boolean, serverKeyId?: string): string {
  return isCustom ? `custom:${serverKeyId}:${modelPath}` : `${version}:${modelPath}`;
}

// ── Bundle preload ─────────────────────────────────────────────────────────────

export async function preloadModels(
  version: string,
  isCustom = false,
  serverKeyId?: string,
): Promise<void> {
  const url = isCustom && serverKeyId
    ? `${API_URL}/api/v1/model-bundle/custom/${serverKeyId}?version=${version}`
    : `${API_URL}/api/v1/model-bundle/${version}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const bundle = await res.json() as Record<string, ResolvedModel>;
    for (const [path, model] of Object.entries(bundle)) {
      resolvedModelCache.set(cacheKey(path, version, isCustom, serverKeyId), model);
    }
  } catch { /* silently degrade — individual fetches will handle it */ }
}

// ── Model fetching + resolution ────────────────────────────────────────────────

// Model JSON cache — block/orientable, block/cube_all etc. are shared by hundreds
// of items; without this every render re-fetches the full parent chain.
const modelJsonCache = new Map<string, Promise<Record<string, unknown> | null>>();

function fetchModel(
  modelPath: string, version: string, isCustom: boolean, serverKeyId?: string,
): Promise<Record<string, unknown> | null> {
  const url = isCustom
    ? `${API_URL}/api/v1/models/custom/${serverKeyId}/${modelPath}`
    : `${API_URL}/api/v1/models/${version}/${modelPath}`;
  if (modelJsonCache.has(url)) return modelJsonCache.get(url)!;
  const promise = fetch(url)
    .then(res => res.ok ? res.json() as Promise<Record<string, unknown>> : null)
    .catch(() => null);
  modelJsonCache.set(url, promise);
  return promise;
}

export async function resolveModel(
  modelPath: string,
  version: string,
  isCustom = false,
  serverKeyId?: string,
  depth = 0,
): Promise<ResolvedModel | null> {
  if (depth > 8) return null;
  // Fast path: bundle was pre-loaded by preloadModels()
  const key = cacheKey(modelPath, version, isCustom, serverKeyId);
  if (resolvedModelCache.has(key)) return resolvedModelCache.get(key)!;
  const m = await fetchModel(modelPath, version, isCustom, serverKeyId);
  if (!m) return null;

  let result: ResolvedModel = { elements: [], textures: {}, guiLight: "side" };

  if (typeof m.parent === "string") {
    const parentPath = (m.parent as string).replace(/^minecraft:/, "");
    const parentResult = await resolveModel(parentPath, version, false, undefined, depth + 1);
    if (parentResult) result = { ...parentResult };
  }

  if (m.textures && typeof m.textures === "object") {
    result.textures = { ...result.textures, ...(m.textures as Record<string, string>) };
  }
  if (Array.isArray(m.elements) && (m.elements as unknown[]).length > 0) {
    result.elements = m.elements as ModelElement[];
  }

  const display = m.display as Record<string, unknown> | undefined;
  if (display?.gui) result.display = display.gui as DisplayTransform;
  if (m.gui_light === "front") result.guiLight = "front";
  else if (m.gui_light === "side") result.guiLight = "side";

  return result;
}

// ── Texture variable resolution ────────────────────────────────────────────────

function resolveVar(textures: Record<string, string>, key: string, depth = 0): string | null {
  if (depth > 8) return null;
  const v = textures[key];
  if (!v) return null;
  if (v.startsWith("#")) return resolveVar(textures, v.slice(1), depth + 1);
  return v.replace(/^minecraft:/, "");
}

// ── Flat 2D layer compositing (item/generated multi-layer items) ───────────────

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function renderFlat(
  model: ResolvedModel,
  version: string,
  isCustom: boolean,
  serverKeyId?: string,
  tints?: Record<number, string>,
): Promise<string | null> {
  const layers: Array<{ url: string; tint?: string }> = [];
  for (let i = 0; ; i++) {
    const texPath = resolveVar(model.textures, `layer${i}`);
    if (!texPath) break;
    const url = isCustom && serverKeyId
      ? `${API_URL}/api/v1/textures/custom/${serverKeyId}/${texPath}`
      : `${API_URL}/api/v1/textures/${version}/${texPath}`;
    layers.push({ url, tint: tints?.[i] });
  }
  if (layers.length === 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  for (const { url, tint } of layers) {
    const img = await loadImage(url);
    if (!img) continue;
    if (tint) {
      // Tint layer: draw on temp canvas, multiply with tint color, restore alpha
      const tmp = document.createElement("canvas");
      tmp.width = 128; tmp.height = 128;
      const tc = tmp.getContext("2d")!;
      tc.imageSmoothingEnabled = false;
      tc.drawImage(img, 0, 0, 128, 128);
      tc.globalCompositeOperation = "multiply";
      tc.fillStyle = tint;
      tc.fillRect(0, 0, 128, 128);
      tc.globalCompositeOperation = "destination-in";
      tc.drawImage(img, 0, 0, 128, 128);
      ctx.drawImage(tmp, 0, 0);
    } else {
      ctx.drawImage(img, 0, 0, 128, 128);
    }
  }
  return canvas.toDataURL("image/png");
}

// ── Entity model rendering ────────────────────────────────────────────────────

interface EntityBox {
  origin: [number, number, number];
  size: [number, number, number];
  texOffset: [number, number];
}

interface EntityRenderDef {
  textureW: number;
  textureH: number;
  texturePath: string;
  boxes: EntityBox[];
  display: { rotation: [number, number, number]; translation: [number, number, number]; scale: [number, number, number] };
  /** When false, skip the scale(1,-1,-1) y-flip (chests render correctly in entity space). Default: true. */
  yFlip?: boolean;
}

// Flat entity crop: load entity texture, crop a rectangular region, scale to icon.
// Used for shulkers whose entity textures (1.21.11+) only have content in the top face rows.
interface EntityFlatDef {
  texturePath: string;
  sx: number; sy: number; sw: number; sh: number; // source crop in texture pixels
}

const SHULKER_FLAT_DEF = (color: string): EntityFlatDef => ({
  texturePath: color === "shulker" ? "entity/shulker/shulker" : `entity/shulker/shulker_${color}`,
  sx: 16, sy: 0, sw: 16, sh: 16, // lid up-face: texOffset(0,0), d=16 → (u+d, v, u+d+w, v+d) = (16,0,32,16)
});

const ENTITY_FLAT_MAP: Record<string, EntityFlatDef> = {
  shulker_box:            SHULKER_FLAT_DEF("shulker"),
  black_shulker_box:      SHULKER_FLAT_DEF("black"),
  blue_shulker_box:       SHULKER_FLAT_DEF("blue"),
  brown_shulker_box:      SHULKER_FLAT_DEF("brown"),
  cyan_shulker_box:       SHULKER_FLAT_DEF("cyan"),
  gray_shulker_box:       SHULKER_FLAT_DEF("gray"),
  green_shulker_box:      SHULKER_FLAT_DEF("green"),
  light_blue_shulker_box: SHULKER_FLAT_DEF("light_blue"),
  light_gray_shulker_box: SHULKER_FLAT_DEF("light_gray"),
  lime_shulker_box:       SHULKER_FLAT_DEF("lime"),
  magenta_shulker_box:    SHULKER_FLAT_DEF("magenta"),
  orange_shulker_box:     SHULKER_FLAT_DEF("orange"),
  pink_shulker_box:       SHULKER_FLAT_DEF("pink"),
  purple_shulker_box:     SHULKER_FLAT_DEF("purple"),
  red_shulker_box:        SHULKER_FLAT_DEF("red"),
  white_shulker_box:      SHULKER_FLAT_DEF("white"),
  yellow_shulker_box:     SHULKER_FLAT_DEF("yellow"),
};

async function renderEntityFlat(itemId: string, version: string): Promise<string | null> {
  const def = ENTITY_FLAT_MAP[itemId];
  if (!def) return null;
  const url = `${API_URL}/api/v1/textures/${version}/${def.texturePath}`;
  const img = await loadImage(url);
  if (!img) return null;
  const canvas = document.createElement("canvas");
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, def.sx, def.sy, def.sw, def.sh, 0, 0, 128, 128);
  return canvas.toDataURL("image/png");
}

const SHIELD_DISPLAY = { rotation: [15, -25, -5] as [number,number,number], translation: [2, 3, 0] as [number,number,number], scale: [0.65, 0.65, 0.65] as [number,number,number] };
// Chests: -45° Y shows south(lock face) + east(right side), matching Minecraft's GUI display.
const CHEST_DISPLAY = { rotation: [30, -45, 0] as [number,number,number], translation: [0, 0, 0] as [number,number,number], scale: [0.625, 0.625, 0.625] as [number,number,number] };
const CHEST_BOXES: EntityBox[] = [
  { origin: [-7, -7.5, -7], size: [14, 10, 14], texOffset: [0, 19] }, // body
  { origin: [-7, 2.5, -7],  size: [14, 5, 14],  texOffset: [0, 0] },  // lid
  { origin: [-1, 0.5, 7],   size: [2, 4, 1],    texOffset: [0, 0] },  // lock hasp
];
// Skull items: one 8×8×8 entity-layout cube (face region at texOffset 0,0 of the
// mob/skin texture). GUI transform from item/template_skull: rotation [30,45,0].
const HEAD_DISPLAY = { rotation: [30, 45, 0] as [number,number,number], translation: [0, 0, 0] as [number,number,number], scale: [1.1, 1.1, 1.1] as [number,number,number] };
const headDef = (texturePath: string, textureW: number, textureH: number): EntityRenderDef => ({
  textureW, textureH, texturePath,
  boxes: [{ origin: [-4, -4, -4], size: [8, 8, 8], texOffset: [0, 0] }],
  // Skin UVs already place the face south and the hair on top.
  yFlip: false,
  display: HEAD_DISPLAY,
});
export const ENTITY_RENDER_MAP: Record<string, EntityRenderDef> = {
  shield: {
    textureW: 64, textureH: 64, texturePath: "entity/shield_base",
    boxes: [
      { origin: [-6, -11, -2], size: [12, 22, 1], texOffset: [0, 0] },
      { origin: [-1, -3, -1],  size: [2, 6, 6],   texOffset: [26, 0] },
    ],
    display: SHIELD_DISPLAY,
  },
  chest:                    { textureW: 64, textureH: 64, texturePath: "entity/chest/normal",           boxes: CHEST_BOXES, display: CHEST_DISPLAY, yFlip: false },
  ender_chest:              { textureW: 64, textureH: 64, texturePath: "entity/chest/ender",            boxes: CHEST_BOXES, display: CHEST_DISPLAY, yFlip: false },
  trapped_chest:            { textureW: 64, textureH: 64, texturePath: "entity/chest/trapped",          boxes: CHEST_BOXES, display: CHEST_DISPLAY, yFlip: false },
  copper_chest:             { textureW: 64, textureH: 64, texturePath: "entity/chest/copper",           boxes: CHEST_BOXES, display: CHEST_DISPLAY, yFlip: false },
  exposed_copper_chest:     { textureW: 64, textureH: 64, texturePath: "entity/chest/copper_exposed",   boxes: CHEST_BOXES, display: CHEST_DISPLAY, yFlip: false },
  weathered_copper_chest:   { textureW: 64, textureH: 64, texturePath: "entity/chest/copper_weathered", boxes: CHEST_BOXES, display: CHEST_DISPLAY, yFlip: false },
  oxidized_copper_chest:    { textureW: 64, textureH: 64, texturePath: "entity/chest/copper_oxidized",  boxes: CHEST_BOXES, display: CHEST_DISPLAY, yFlip: false },
  waxed_copper_chest:           { textureW: 64, textureH: 64, texturePath: "entity/chest/copper",           boxes: CHEST_BOXES, display: CHEST_DISPLAY, yFlip: false },
  waxed_exposed_copper_chest:   { textureW: 64, textureH: 64, texturePath: "entity/chest/copper_exposed",   boxes: CHEST_BOXES, display: CHEST_DISPLAY, yFlip: false },
  waxed_weathered_copper_chest: { textureW: 64, textureH: 64, texturePath: "entity/chest/copper_weathered", boxes: CHEST_BOXES, display: CHEST_DISPLAY, yFlip: false },
  waxed_oxidized_copper_chest:  { textureW: 64, textureH: 64, texturePath: "entity/chest/copper_oxidized",  boxes: CHEST_BOXES, display: CHEST_DISPLAY, yFlip: false },
  player_head:           headDef("entity/player/wide/steve", 64, 64),
  zombie_head:           headDef("entity/zombie/zombie", 64, 64),
  creeper_head:          headDef("entity/creeper/creeper", 64, 32),
  skeleton_skull:        headDef("entity/skeleton/skeleton", 64, 32),
  wither_skeleton_skull: headDef("entity/skeleton/wither_skeleton", 64, 32),
  piglin_head:           headDef("entity/piglin/piglin", 64, 64),
  // Dragon head: approximated by the dragon model's 16³ head cube (256×256 sheet).
  // texOffset [128,30] lands the front face on the dragon's eyes + snout region,
  // giving a recognizable two-eyed black face (the dragon texture is mostly black).
  dragon_head: {
    textureW: 256, textureH: 256, texturePath: "entity/enderdragon/dragon",
    boxes: [{ origin: [-8, -8, -8], size: [16, 16, 16], texOffset: [128, 30] }],
    display: { ...HEAD_DISPLAY, scale: [0.55, 0.55, 0.55] as [number,number,number] },
  },
};

// Entity cube UV face pixel rects → normalized Three.js UVs (two-triangle quad).
// Pixel space: y↓ (0 = top). Three.js UV: y↑ (0 = bottom).
// swapV=true: swap v1/v2 to compensate for scale(1,-1,-1) so texture appears right-side-up.
// swapV=false (yFlip:false entities like chests): use normal V order.
function entityFaceUVs(
  px1: number, py1: number, px2: number, py2: number,
  texW: number, texH: number,
  swapV: boolean,
): Float32Array {
  const u1 = px1 / texW, u2 = px2 / texW;
  const v1 = 1 - (swapV ? py2 : py1) / texH;
  const v2 = 1 - (swapV ? py1 : py2) / texH;
  // Quad order matches faceVerts: TL, TR, BR, BL → tri1(TL,TR,BR) + tri2(TL,BR,BL)
  return new Float32Array([u1, v1, u2, v1, u2, v2, u1, v1, u2, v2, u1, v2]);
}

function buildEntityBoxMeshes(
  box: EntityBox,
  texture: THREE.Texture,
  textureW: number,
  textureH: number,
  yFlip: boolean,
): THREE.Mesh[] {
  const [ox, oy, oz] = box.origin;
  const [w, h, d] = box.size;
  const [u, v] = box.texOffset;
  const tx = ox + w, ty = oy + h, tz = oz + d;

  // Entity cube UV layout: each face in pixel coords.
  // "down" is always omitted: for yFlip entities it ends up on top (copper_chest opaque square
  // bug); for non-yFlip chests it's the invisible floor.
  // "north" is omitted for non-yFlip (chests): it's the back face, always hidden in GUI view,
  // and it sits coplanar with the body's south face causing z-fighting (lock north face at z=7
  // vs body south face at z=7). For yFlip entities the y-flip turns north into a visible face.
  const faceDefs: Array<["up"|"north"|"south"|"west"|"east", number, number, number, number]> = [
    ["up",    u+d,       v,     u+d+w,     v+d],
    ["west",  u,         v+d,   u+d,       v+d+h],
    ["south", u+d,       v+d,   u+d+w,     v+d+h],
    ["east",  u+d+w,     v+d,   u+2*d+w,   v+d+h],
    ...(yFlip ? [["north", u+2*d+w, v+d, u+2*d+2*w, v+d+h] as ["north", number, number, number, number]] : []),
  ];

  return faceDefs.map(([face, px1, py1, px2, py2]) => {
    const verts = faceVerts(face, ox, oy, oz, tx, ty, tz);
    const positions = new Float32Array([
      ...verts.slice(0,3), ...verts.slice(3,6), ...verts.slice(6,9),
      ...verts.slice(0,3), ...verts.slice(6,9), ...verts.slice(9,12),
    ]);
    const uvs = entityFaceUVs(px1, py1, px2, py2, textureW, textureH, yFlip);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    const shade = FACE_SHADE[face] ?? 1.0;
    const mat = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, alphaTest: 0.01, side: THREE.DoubleSide,
      color: new THREE.Color(shade, shade, shade),
    });
    return new THREE.Mesh(geo, mat);
  });
}

async function renderEntityItem(itemId: string, version: string): Promise<string | null> {
  const def = ENTITY_RENDER_MAP[itemId];
  if (!def) return null;

  const texUrl = `${API_URL}/api/v1/textures/${version}/${def.texturePath}`;
  const texture = await loadTex(texUrl);
  if (!texture) return null;

  const scene = new THREE.Scene();

  const shouldYFlip = def.yFlip !== false;
  // Inner group: scale(1,-1,-1) converts entity y-down / front-facing-south conventions.
  // Chests (yFlip:false) render correctly in entity space and must NOT be flipped.
  const innerGroup = new THREE.Group();
  if (shouldYFlip) innerGroup.scale.set(1, -1, -1);
  for (const box of def.boxes) {
    for (const mesh of buildEntityBoxMeshes(box, texture, def.textureW, def.textureH, shouldYFlip)) {
      innerGroup.add(mesh);
    }
  }

  // Outer group: display.gui transform
  const outerGroup = new THREE.Group();
  outerGroup.add(innerGroup);
  scene.add(outerGroup);

  const { rotation, scale } = def.display;
  outerGroup.scale.set(...scale);
  outerGroup.rotation.order = "XYZ";
  outerGroup.rotation.set(
    THREE.MathUtils.degToRad(rotation[0]),
    THREE.MathUtils.degToRad(rotation[1]),
    THREE.MathUtils.degToRad(rotation[2]),
  );
  // Translation is omitted: entity models fill nearly the full camera frustum (±8 units),
  // so any vertical offset clips the model. Centering at origin looks correct.

  const renderer = getRenderer();
  const camera = getCamera();
  try {
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL("image/png");
  } catch { return null; }
}

// ── Texture loading ─────────────────────────────────────────────────────────────

const texCache = new Map<string, THREE.Texture | null>();

/** Clear all in-memory caches. Intended for use in tests only. */
export function clearCaches(): void {
  renderCache.clear();
  resolvedModelCache.clear();
  modelJsonCache.clear();
  texCache.clear();
}

function loadTex(url: string): Promise<THREE.Texture | null> {
  if (texCache.has(url)) return Promise.resolve(texCache.get(url)!);
  return new Promise(resolve => {
    new THREE.TextureLoader().load(
      url,
      tex => {
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.colorSpace = THREE.SRGBColorSpace;
        texCache.set(url, tex);
        resolve(tex);
      },
      undefined,
      () => { texCache.set(url, null); resolve(null); },
    );
  });
}

async function loadModelTextures(
  model: ResolvedModel, version: string, isCustom: boolean, serverKeyId?: string,
): Promise<Map<string, THREE.Texture>> {
  const resolved = new Map<string, string>();
  for (const key of Object.keys(model.textures)) {
    const path = resolveVar(model.textures, key);
    if (path) resolved.set(key, path);
  }

  const out = new Map<string, THREE.Texture>();
  await Promise.all([...resolved.entries()].map(async ([key, path]) => {
    const url = isCustom
      ? `${API_URL}/api/v1/textures/custom/${serverKeyId}/${path}`
      : `${API_URL}/api/v1/textures/${version}/${path}`;
    const tex = await loadTex(url);
    if (tex) out.set(key, tex);
  }));
  return out;
}

// ── Scene building ─────────────────────────────────────────────────────────────

// Face vertex positions in 0-16 space (viewed from outside, CCW winding):
export function faceVerts(
  face: "down" | "up" | "north" | "south" | "west" | "east",
  fx: number, fy: number, fz: number,
  tx: number, ty: number, tz: number,
): number[] {
  switch (face) {
    case "down":  return [fx,fy,tz, tx,fy,tz, tx,fy,fz, fx,fy,fz];
    case "up":    return [fx,ty,fz, tx,ty,fz, tx,ty,tz, fx,ty,tz];
    case "north": return [tx,ty,fz, fx,ty,fz, fx,fy,fz, tx,fy,fz];
    case "south": return [fx,ty,tz, tx,ty,tz, tx,fy,tz, fx,fy,tz];
    case "west":  return [fx,ty,fz, fx,ty,tz, fx,fy,tz, fx,fy,fz];
    case "east":  return [tx,ty,tz, tx,ty,fz, tx,fy,fz, tx,fy,tz];
  }
}

// Default UV for a face when not specified (from Minecraft wiki):
export function defaultUV(
  face: "down" | "up" | "north" | "south" | "west" | "east",
  from: [number,number,number], to: [number,number,number],
): [number,number,number,number] {
  const [fx,fy,fz] = from; const [tx,ty,tz] = to;
  switch (face) {
    case "down":  return [fx, 16-tz, tx, 16-fz];
    case "up":    return [fx, fz,    tx, tz];
    case "north": return [16-tx, 16-ty, 16-fx, 16-fy];
    case "south": return [fx, 16-ty, tx, 16-fy];
    case "west":  return [fz, 16-ty, tz, 16-fy];
    case "east":  return [16-tz, 16-ty, 16-fz, 16-fy];
  }
}

// Minecraft directional face brightness (matches Java Edition GUI rendering).
const FACE_SHADE: Record<string, number> = {
  up: 1.0, down: 0.5, north: 0.8, south: 0.8, east: 0.6, west: 0.6,
};

// Minecraft face UV (top-left origin, y↓, 0-16) → Three.js UV (bottom-left, y↑, 0-1),
// with clockwise texture rotation applied.
export function faceUVs(u1: number, v1: number, u2: number, v2: number, rotation: number): Float32Array {
  const corners: [number, number][] = [
    [u1/16, 1-v1/16], // TL
    [u2/16, 1-v1/16], // TR
    [u2/16, 1-v2/16], // BR
    [u1/16, 1-v2/16], // BL
  ];
  const steps = ((rotation / 90) % 4 + 4) % 4;
  const uv = (i: number) => corners[((i - steps) % 4 + 4) % 4]!;
  return new Float32Array([
    ...uv(0), ...uv(1), ...uv(2),
    ...uv(0), ...uv(2), ...uv(3),
  ]);
}

function buildFaceMesh(
  face: "down" | "up" | "north" | "south" | "west" | "east",
  faceData: ModelFace,
  from: [number,number,number],
  to: [number,number,number],
  textures: Map<string, THREE.Texture>,
  modelTextures: Record<string, string>,
  shaded: boolean,
): THREE.Mesh | null {
  const texKey = faceData.texture.startsWith("#")
    ? faceData.texture.slice(1)
    : faceData.texture;
  const resolvedKey = resolveVar(modelTextures, texKey) ?? texKey;
  const tex = textures.get(resolvedKey) ?? textures.get(texKey);
  if (!tex) return null;

  const [fx,fy,fz] = from; const [tx,ty,tz] = to;
  const verts = faceVerts(face, fx, fy, fz, tx, ty, tz);
  const positions = new Float32Array([
    ...verts.slice(0,3), ...verts.slice(3,6), ...verts.slice(6,9),
    ...verts.slice(0,3), ...verts.slice(6,9), ...verts.slice(9,12),
  ]);

  const [u1,v1,u2,v2] = faceData.uv ?? defaultUV(face, from, to);
  const uvs = faceUVs(u1, v1, u2, v2, faceData.rotation ?? 0);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));

  const brightness = shaded ? (FACE_SHADE[face] ?? 1.0) : 1.0;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    color: new THREE.Color(brightness, brightness, brightness),
    transparent: true,
    alphaTest: 0.01,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
}

function buildScene(model: ResolvedModel, textures: Map<string, THREE.Texture>): THREE.Scene {
  const scene = new THREE.Scene();
  const modelGroup = new THREE.Group();
  // Center model at origin (Minecraft elements are in 0-16 space)
  modelGroup.position.set(-8, -8, -8);
  scene.add(modelGroup);

  const FACES = ["down", "up", "north", "south", "west", "east"] as const;

  for (const elem of model.elements) {
    const elemGroup = new THREE.Group();
    // gui_light:"front" or shade:false → no directional shading (all faces at full brightness).
    // gui_light:"side" with shade:true (the default) → Minecraft's per-face FACE_SHADE values.
    const shaded = elem.shade !== false && model.guiLight !== "front";

    if (elem.rotation) {
      const { origin, axis, angle, rescale } = elem.rotation;
      const rad = THREE.MathUtils.degToRad(angle);
      const pivot = new THREE.Group();
      pivot.position.set(origin[0] - 8, origin[1] - 8, origin[2] - 8);
      if (axis === "x") pivot.rotation.x = rad;
      else if (axis === "y") pivot.rotation.y = rad;
      else if (axis === "z") pivot.rotation.z = rad;

      // rescale: expand element perpendicular to rotation axis so it covers the original voxel.
      // Factor = 1/cos(θ). Applied as a child of the rotated pivot so it acts in rotated space.
      let container: THREE.Object3D = pivot;
      if (rescale) {
        const factor = 1 / Math.cos(Math.abs(rad));
        const sg = new THREE.Group();
        if (axis === "x") sg.scale.set(1, factor, factor);
        else if (axis === "y") sg.scale.set(factor, 1, factor);
        else sg.scale.set(factor, factor, 1);
        pivot.add(sg);
        container = sg;
      }

      const inner = new THREE.Group();
      inner.position.set(-(origin[0] - 8), -(origin[1] - 8), -(origin[2] - 8));
      container.add(inner);
      for (const face of FACES) {
        const faceData = elem.faces[face];
        if (!faceData) continue;
        const mesh = buildFaceMesh(face, faceData, elem.from, elem.to, textures, model.textures, shaded);
        if (mesh) inner.add(mesh);
      }
      elemGroup.add(pivot);
    } else {
      for (const face of FACES) {
        const faceData = elem.faces[face];
        if (!faceData) continue;
        const mesh = buildFaceMesh(face, faceData, elem.from, elem.to, textures, model.textures, shaded);
        if (mesh) elemGroup.add(mesh);
      }
    }

    modelGroup.add(elemGroup);
  }

  // Apply display.gui transform (Minecraft order: scale → XYZ rotation → translation)
  const displayGroup = new THREE.Group();
  scene.remove(modelGroup);
  displayGroup.add(modelGroup);
  scene.add(displayGroup);

  const display = model.display ?? {
    rotation: [30, 225, 0],
    translation: [0, 0, 0],
    scale: [0.625, 0.625, 0.625],
  };

  if (display.scale) {
    const [sx, sy, sz] = display.scale;
    displayGroup.scale.set(Math.min(4, sx), Math.min(4, sy), Math.min(4, sz));
  }
  if (display.rotation) {
    const [rx, ry, rz] = display.rotation;
    displayGroup.rotation.order = "XYZ";
    displayGroup.rotation.set(
      THREE.MathUtils.degToRad(rx),
      THREE.MathUtils.degToRad(ry),
      THREE.MathUtils.degToRad(rz),
    );
  }
  if (display.translation) {
    const [tx, ty, tz] = display.translation;
    displayGroup.position.set(
      Math.max(-80, Math.min(80, tx)),
      Math.max(-80, Math.min(80, ty)),
      Math.max(-80, Math.min(80, tz)),
    );
  }

  return scene;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function renderToCanvas(
  modelPath: string,
  version: string,
  isCustom = false,
  serverKeyId?: string,
  tints?: Record<number, string>,
): Promise<string | null> {
  const key = cacheKey(modelPath, version, isCustom, serverKeyId);
  if (renderCache.has(key)) return renderCache.get(key)!;

  const promise = (async (): Promise<string | null> => {
    // Entity items rendered with hardcoded geometry + entity textures
    if (modelPath.startsWith("__entity__/")) {
      return renderEntityItem(modelPath.slice("__entity__/".length), version);
    }
    // Entity items rendered as a 2D crop of the entity texture (e.g. shulker top face)
    if (modelPath.startsWith("__entity_flat__/")) {
      return renderEntityFlat(modelPath.slice("__entity_flat__/".length), version);
    }

    const model = await resolveModel(modelPath, version, isCustom, serverKeyId);
    if (!model) return null;
    if (model.elements.length === 0) {
      // Flat multi-layer item (item/generated): composite layers with tints
      if (model.guiLight === "front") return renderFlat(model, version, isCustom, serverKeyId, tints);
      return null;
    }

    const textures = await loadModelTextures(model, version, isCustom, serverKeyId);
    if (textures.size === 0) return null;

    const scene = buildScene(model, textures);
    const renderer = getRenderer();
    const camera = getCamera();

    try {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL("image/png");
    } catch {
      return null;
    }
  })();

  renderCache.set(key, promise);
  return promise;
}
