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
    _renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    _renderer.setSize(128, 128);
    _renderer.setClearColor(0x000000, 0);
  }
  return _renderer;
}

function getCamera(): THREE.OrthographicCamera {
  if (!_camera) {
    // Model space: 0-16 units per block, centered at (8,8,8) → group offset to origin.
    // Camera sees ±10 units to give margin around the 8-unit radius of a full block.
    _camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
    _camera.position.set(0, 0, 100);
    _camera.lookAt(0, 0, 0);
  }
  return _camera;
}

// ── Render cache ───────────────────────────────────────────────────────────────

const renderCache = new Map<string, Promise<string | null>>();

function cacheKey(modelPath: string, version: string, isCustom: boolean, serverKeyId?: string): string {
  return isCustom ? `custom:${serverKeyId}:${modelPath}` : `${version}:${modelPath}`;
}

// ── Model fetching + resolution ────────────────────────────────────────────────

async function fetchModel(
  modelPath: string, version: string, isCustom: boolean, serverKeyId?: string,
): Promise<Record<string, unknown> | null> {
  const url = isCustom
    ? `${API_URL}/api/models/custom/${serverKeyId}/${modelPath}`
    : `${API_URL}/api/models/${version}/${modelPath}`;
  try {
    const res = await fetch(url);
    return res.ok ? (res.json() as Promise<Record<string, unknown>>) : null;
  } catch {
    return null;
  }
}

export async function resolveModel(
  modelPath: string,
  version: string,
  isCustom = false,
  serverKeyId?: string,
  depth = 0,
): Promise<ResolvedModel | null> {
  if (depth > 8) return null;
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

// ── Texture loading ─────────────────────────────────────────────────────────────

const texCache = new Map<string, THREE.Texture | null>();

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
      ? `${API_URL}/api/textures/custom/${serverKeyId}/${path}`
      : `${API_URL}/api/textures/${version}/${path}`;
    const tex = await loadTex(url);
    if (tex) out.set(key, tex);
  }));
  return out;
}

// ── Scene building ─────────────────────────────────────────────────────────────

// Face vertex positions in 0-16 space (viewed from outside, CCW winding):
function faceVerts(
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
function defaultUV(
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

// Minecraft face UV (top-left origin, y↓, 0-16) → Three.js UV (bottom-left, y↑, 0-1),
// with clockwise texture rotation applied.
function faceUVs(u1: number, v1: number, u2: number, v2: number, rotation: number): Float32Array {
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

  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.01, side: THREE.FrontSide });
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

    if (elem.rotation) {
      const { origin, axis, angle } = elem.rotation;
      const rad = THREE.MathUtils.degToRad(angle);
      const pivot = new THREE.Group();
      pivot.position.set(origin[0] - 8, origin[1] - 8, origin[2] - 8);
      const inner = new THREE.Group();
      inner.position.set(-(origin[0] - 8), -(origin[1] - 8), -(origin[2] - 8));
      if (axis === "x") pivot.rotation.x = rad;
      else if (axis === "y") pivot.rotation.y = rad;
      else if (axis === "z") pivot.rotation.z = rad;
      pivot.add(inner);
      for (const face of FACES) {
        const faceData = elem.faces[face];
        if (!faceData) continue;
        const mesh = buildFaceMesh(face, faceData, elem.from, elem.to, textures, model.textures);
        if (mesh) inner.add(mesh);
      }
      elemGroup.add(pivot);
    } else {
      for (const face of FACES) {
        const faceData = elem.faces[face];
        if (!faceData) continue;
        const mesh = buildFaceMesh(face, faceData, elem.from, elem.to, textures, model.textures);
        if (mesh) elemGroup.add(mesh);
      }
    }

    modelGroup.add(elemGroup);
  }

  // Apply display.gui transform (Minecraft order: scale → YXZ rotation → translation)
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
    displayGroup.rotation.order = "YXZ";
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
): Promise<string | null> {
  const key = cacheKey(modelPath, version, isCustom, serverKeyId);
  if (renderCache.has(key)) return renderCache.get(key)!;

  const promise = (async (): Promise<string | null> => {
    const model = await resolveModel(modelPath, version, isCustom, serverKeyId);
    if (!model || model.elements.length === 0) return null;

    const textures = await loadModelTextures(model, version, isCustom, serverKeyId);
    if (textures.size === 0) return null;

    const scene = buildScene(model, textures);
    const renderer = getRenderer();
    const camera = getCamera();

    renderer.render(scene, camera);
    return renderer.domElement.toDataURL("image/png");
  })();

  renderCache.set(key, promise);
  return promise;
}
