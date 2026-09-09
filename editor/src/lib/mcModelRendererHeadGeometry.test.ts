import * as THREE from "three";
import { beforeEach, expect, it, vi } from "vitest";
import { clearCaches, renderToCanvas } from "./mcModelRenderer";

const captured = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  return {
    ...actual,
    WebGLRenderer: class {
      setSize() {}
      setClearColor() {}
      render = captured.render;
      domElement = { toDataURL: () => "data:image/png;base64,test" };
    },
    TextureLoader: class {
      load(_url: string, ready: (texture: THREE.Texture) => void) {
        ready(new actual.Texture());
      }
    },
  };
});

beforeEach(() => {
  clearCaches();
  captured.render.mockClear();
});

it.each(["player_head", "zombie_head"])(
  "%s has a closed top and the face skin on the front",
  async (id) => {
    await renderToCanvas(`__entity__/${id}`, "1.21.11");
    const scene = captured.render.mock.calls[0][0] as THREE.Scene;
    scene.updateMatrixWorld(true);
    const display = scene.children[0];
    for (const [point, normal, expectedUV] of [
      [new THREE.Vector3(0, 4, 0), new THREE.Vector3(0, 1, 0), [12 / 64, 1 - 4 / 64]],
      [new THREE.Vector3(0, 0, 4), new THREE.Vector3(0, 0, 1), [12 / 64, 1 - 12 / 64]],
    ] as const) {
      const surface = display.localToWorld(point.clone());
      const outward = normal.clone().transformDirection(display.matrixWorld);
      const ray = new THREE.Raycaster(
        surface.clone().addScaledVector(outward, 10),
        outward.negate(),
      );
      const hit = ray.intersectObject(scene, true)[0];
      expect(hit, "the outer surface must exist").toBeDefined();
      expect(hit.point.distanceTo(surface)).toBeLessThan(0.0001);
      expect(hit.uv?.x).toBeCloseTo(expectedUV[0]);
      expect(hit.uv?.y).toBeCloseTo(expectedUV[1]);
    }
  },
);
