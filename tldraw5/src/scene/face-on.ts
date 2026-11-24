// The scene's camera for a drawing edited in place: face on to its plane, where the page lies on
// the screen as tldraw's own camera shows it, so tldraw's canvas, laid flat over the scene's view,
// and the scene drawn behind it agree. tldraw maps a page point p to the screen at (p + c) · z (its
// camera { x, y, z }); a perspective camera looking straight at a plane maps it by a uniform scale
// too, so one fits the other exactly: the page point at the middle of the view is straight ahead,
// a page unit is z pixels, and the page's x and y run right and down the screen.

import { pageToLocal, type Affine } from "./choices.ts";

type V3 = [number, number, number];
/** A 4×4 matrix as three.js keeps it: 16 numbers, column-major. */
export type Matrix16 = ArrayLike<number>;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const length = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const normalize = (a: V3): V3 => scale(a, 1 / (length(a) || 1));
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const transform = (m: Matrix16, p: V3): V3 => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

/** The rotation whose x, y and z axes are these orthonormal vectors, as a quaternion [x, y, z, w]. */
export function quaternionOfBasis(x: V3, y: V3, z: V3): [number, number, number, number] {
  const [m11, m21, m31] = x;
  const [m12, m22, m32] = y;
  const [m13, m23, m33] = z;
  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return [(m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s];
  }
  if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    return [0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s];
  }
  if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    return [(m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s];
  }
  const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
  return [(m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s];
}

/**
 * The scene camera that shows the page as tldraw's camera does.
 * @param o.matrix    the scene object's drawn matrix, in the frame the camera is set in
 * @param o.toOrigin  page → the shown thing's own frame (./choices.ts): the identity for a page
 * @param o.camera    tldraw's camera
 * @param o.viewport  tldraw's viewport on the screen, in pixels: the scene's view, as it covers it
 * @param o.fov       the scene camera's vertical field of view, in degrees
 */
export function faceOn(o: { matrix: Matrix16; toOrigin?: Affine; camera: { x: number; y: number; z: number }; viewport: { w: number; h: number }; fov: number }) {
  const { matrix, toOrigin, camera, viewport, fov } = o;
  // the page point at the middle of the view, and a page unit along x and y from it, in the world
  const cx = viewport.w / 2 / camera.z - camera.x;
  const cy = viewport.h / 2 / camera.z - camera.y;
  const at = (x: number, y: number) => transform(matrix, pageToLocal(x, y, toOrigin));
  const target = at(cx, cy);
  const ex = sub(at(cx + 1, cy), target);
  const ey = sub(at(cx, cy + 1), target);
  const unit = length(ex); // metres of a page unit, the object's scale included
  const right = normalize(ex);
  const up = normalize(scale(ey, -1)); // the page's y runs down the screen
  const back = normalize(cross(right, up)); // toward the viewer: the side the picture faces
  // a page unit is camera.z pixels: the distance at which the view's height covers h / z units
  const distance = ((unit / camera.z) * viewport.h) / (2 * Math.tan((fov * Math.PI) / 360));
  return { position: add(target, scale(back, distance)), quaternion: quaternionOfBasis(right, up, back), target };
}
