// Types for the part of glb.js this package uses. glb.js is the scene's GLB encoder (patchwork-experiments/scene/src/glb.js), copied whole and never edited (its own header says why), so it stays JS beside this declaration.

type Floats = Float32Array | number[];
type Color = string | [number, number, number] | [number, number, number, number];

export interface GlbTexture {
  image: Uint8Array;
  mimeType: "image/png" | "image/jpeg";
  smooth?: boolean;
  repeat?: boolean;
}

export interface GlbPrimitive {
  positions: Floats;
  normals?: Floats;
  uvs?: Floats;
  indices?: Uint32Array | Uint16Array | number[];
  mode?: number;
  color?: Color;
  metallic?: number;
  roughness?: number;
  doubleSided?: boolean;
  unlit?: boolean;
  blend?: boolean;
  texture?: GlbTexture;
  materialExtras?: object;
}

export interface GlbMesh {
  name?: string;
  primitives: GlbPrimitive[];
  extras?: object;
}

export interface GlbNode {
  name?: string;
  mesh?: number;
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  children?: number[];
  extras?: object;
}

export interface GlbScene {
  meshes: GlbMesh[];
  nodes?: GlbNode[];
  extras?: object;
  generator?: string;
  copyright?: string;
  units?: string;
}

export type Bounds = { min: [number, number, number]; max: [number, number, number] };

export function encodeGLB(scene: GlbScene): Uint8Array;
export function computeBounds(positions: Floats): Bounds | null;
export function parseGLB(bytes: Uint8Array): { json: any; bin: Uint8Array | null };
