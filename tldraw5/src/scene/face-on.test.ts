import { describe, it, expect } from "vitest";
import { faceOn, quaternionOfBasis } from "./face-on.ts";
import { METRES_PER_UNIT, pageToLocal } from "./choices.ts";

// a pinhole camera as three.js's: looking down its −z, y up, the vertical fov over the view's height
function project(cam: ReturnType<typeof faceOn>, fov: number, view: { w: number; h: number }, p: number[]) {
  const [x, y, z, w] = cam.quaternion;
  // the inverse rotation applied to p − position
  const v = [p[0] - cam.position[0], p[1] - cam.position[1], p[2] - cam.position[2]];
  const ix = -x, iy = -y, iz = -z;
  const tx = 2 * (iy * v[2] - iz * v[1]), ty = 2 * (iz * v[0] - ix * v[2]), tz = 2 * (ix * v[1] - iy * v[0]);
  const r = [v[0] + w * tx + (iy * tz - iz * ty), v[1] + w * ty + (iz * tx - ix * tz), v[2] + w * tz + (ix * ty - iy * tx)];
  const f = view.h / 2 / Math.tan((fov * Math.PI) / 360);
  return [view.w / 2 + (f * r[0]) / -r[2], view.h / 2 - (f * r[1]) / -r[2]];
}
const tldraw = (camera: { x: number; y: number; z: number }, p: number[]) => [(p[0] + camera.x) * camera.z, (p[1] + camera.y) * camera.z];
const apply = (m: number[], p: number[]) => [0, 1, 2].map((i) => m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i]);
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe("faceOn", () => {
  const view = { w: 1200, h: 800 };
  const fov = 45;
  const pages = [[0, 0], [300, 120], [-50, 640], [1000, 1000]];

  const cases: [string, number[]][] = [
    ["an upright drawing at the origin", IDENTITY],
    // laid flat on the floor (a quarter turn about x), moved, and scaled by 2
    ["a drawing on the floor, moved and scaled", [2, 0, 0, 0, 0, 0, 2, 0, 0, -2, 0, 0, 1, 0.5, -3, 1]],
    // turned about its normal by 30°: the page's axes still run along the screen's
    ["a drawing turned in its plane", [Math.cos(0.5236), Math.sin(0.5236), 0, 0, -Math.sin(0.5236), Math.cos(0.5236), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]],
  ];
  for (const [name, matrix] of cases) {
    it(`puts every page point where tldraw draws it: ${name}`, () => {
      for (const camera of [{ x: 0, y: 0, z: 1 }, { x: -120, y: 40, z: 2.5 }, { x: 300, y: -200, z: 0.3 }]) {
        const cam = faceOn({ matrix, camera, viewport: view, fov });
        for (const p of pages) {
          const world = apply(matrix, pageToLocal(p[0], p[1]));
          const [sx, sy] = project(cam, fov, view, world);
          const [tx, ty] = tldraw(camera, p);
          expect(sx).toBeCloseTo(tx, 6);
          expect(sy).toBeCloseTo(ty, 6);
        }
      }
    });
  }

  it("looks at the page point in the middle of the view, from the side the picture faces", () => {
    const cam = faceOn({ matrix: IDENTITY, camera: { x: 0, y: 0, z: 1 }, viewport: view, fov });
    expect(cam.target.map((v) => v / METRES_PER_UNIT)).toEqual([600, -400, 0].map((v) => expect.closeTo(v, 6)));
    expect(cam.position[2]).toBeGreaterThan(0);
  });

  it("goes through a frame's own origin as the build does", () => {
    // a frame at (100, 50) turned a quarter turn: the page's axes are the frame's, turned
    const toOrigin = { a: 0, b: -1, c: 1, d: 0, e: -50, f: 100 };
    const camera = { x: 10, y: 20, z: 1.5 };
    const cam = faceOn({ matrix: IDENTITY, toOrigin, camera, viewport: view, fov });
    for (const p of pages) {
      const [sx, sy] = project(cam, fov, view, pageToLocal(p[0], p[1], toOrigin));
      const [tx, ty] = tldraw(camera, p);
      expect(sx).toBeCloseTo(tx, 6);
      expect(sy).toBeCloseTo(ty, 6);
    }
  });
});

describe("quaternionOfBasis", () => {
  it("is the identity for the standard axes, and a quarter turn about y for x → −z", () => {
    expect(quaternionOfBasis([1, 0, 0], [0, 1, 0], [0, 0, 1])).toEqual([0, 0, 0, 1]);
    const q = quaternionOfBasis([0, 0, -1], [0, 1, 0], [1, 0, 0]);
    expect(q.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, Math.round(Math.SQRT1_2 * 1e6) / 1e6, 0, Math.round(Math.SQRT1_2 * 1e6) / 1e6]);
  });
});
