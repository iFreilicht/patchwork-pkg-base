// What a tldraw drawing shows in a scene, and where: pure, from the document's records alone, so
// the scene can ask for it without a canvas (its `params(doc)`), and the build places its picture
// with it. A placement shows one page whole or one frame on a page; its origin is the page's
// origin, or the frame's top left corner with the frame's axes, at the object's origin.

/** The scene param that says what a placement shows: a page's id or a frame's. */
export const SHOW = "show";

/** Metres per page unit: a CSS pixel at tldraw's zoom 1, 96 to the inch, so a drawing shows at its printed size. */
export const METRES_PER_UNIT = 0.0254 / 96;

type Rec = { id: string; typeName?: string; type?: string; index?: string; parentId?: string; name?: string; props?: { name?: unknown } };
type Store = Record<string, unknown>;

export type Option = { value: string; label: string; group?: string };
export type ShowSpec = { key: typeof SHOW; label: string; kind: "enum"; default: string; options: Option[] };

const records = (store: Store | undefined): Rec[] => Object.values(store ?? {}).filter((r): r is Rec => !!r && typeof r === "object" && typeof (r as Rec).id === "string");
// tldraw orders siblings by their fractional `index`, compared as plain strings
const byIndex = (a: Rec, b: Rec) => {
  const x = a.index ?? "";
  const y = b.index ?? "";
  if (x !== y) return x < y ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/** The document's pages, in tldraw's order. */
export function pagesOf(store: Store | undefined): Rec[] {
  return records(store)
    .filter((r) => r.typeName === "page")
    .sort(byIndex);
}

const frameName = (r: Rec) => (typeof r.props?.name === "string" && r.props.name.trim() ? r.props.name.trim() : "Frame");

/** A page's frames, depth first in drawing order, each with the names of the frames it is in. */
export function framesOf(store: Store | undefined, pageId: string): { id: string; path: string[] }[] {
  const shapes = records(store).filter((r) => r.typeName === "shape");
  const children = new Map<string, Rec[]>();
  for (const s of shapes) {
    const list = children.get(s.parentId ?? "") ?? [];
    list.push(s);
    children.set(s.parentId ?? "", list);
  }
  const out: { id: string; path: string[] }[] = [];
  const walk = (parent: string, path: string[]) => {
    for (const s of (children.get(parent) ?? []).sort(byIndex)) {
      const inner = s.type === "frame" ? [...path, frameName(s)] : path;
      if (s.type === "frame") out.push({ id: s.id, path: inner });
      walk(s.id, inner);
    }
  };
  walk(pageId, []);
  return out;
}

/**
 * The one choice a placement makes: each page whole, and each frame on it, the first page by
 * default. With several pages, each page's entries are under its name (an `<optgroup>` in the
 * scene's form); a name two pages share is told apart by its place. None for a document without
 * pages.
 */
export function showSpec(store: Store | undefined): ShowSpec | null {
  const pages = pagesOf(store);
  if (!pages.length) return null;
  const several = pages.length > 1;
  const seen = new Map<string, number>();
  const options: Option[] = [];
  for (const page of pages) {
    const name = typeof page.name === "string" && page.name.trim() ? page.name.trim() : "Page";
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    const group = several ? (n > 1 ? `${name} (${n})` : name) : undefined;
    const entry = (value: string, label: string): Option => (group ? { value, label, group } : { value, label });
    options.push(entry(page.id, "Whole page"));
    for (const f of framesOf(store, page.id)) options.push(entry(f.id, f.path.join(" › ")));
  }
  return { key: SHOW, label: "Show", kind: "enum", default: pages[0].id, options };
}

/** What `show` names in this document: a page, or a frame and its page; the first page for anything else. */
export function resolveShow(store: Store | undefined, show: unknown): { page: string; frame: string | null; name: string } | null {
  const pages = pagesOf(store);
  if (!pages.length) return null;
  const all = new Map(records(store).map((r) => [r.id, r]));
  const rec = typeof show === "string" ? all.get(show) : undefined;
  if (rec?.typeName === "page") return { page: rec.id, frame: null, name: typeof rec.name === "string" ? rec.name : "Page" };
  if (rec?.typeName === "shape" && rec.type === "frame") {
    let up = all.get(rec.parentId ?? "");
    for (let guard = 0; up && up.typeName !== "page" && guard < 1000; guard++) up = all.get(up.parentId ?? "");
    if (up?.typeName === "page") return { page: up.id, frame: rec.id, name: frameName(rec) };
  }
  const first = pages[0];
  return { page: first.id, frame: null, name: typeof first.name === "string" ? first.name : "Page" };
}

/** A 2D affine map, as tldraw's `Mat`: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Affine = { a: number; b: number; c: number; d: number; e: number; f: number };

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function invert(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c;
  if (!det) return IDENTITY;
  return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det, e: (m.c * m.f - m.d * m.e) / det, f: (m.b * m.e - m.a * m.f) / det };
}

const apply = (m: Affine, x: number, y: number): [number, number] => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];

/**
 * The quad a picture of a page rectangle lies on, in the object's frame (Y up, metres): `box` in
 * page units, mapped by `toOrigin` (page → the shown thing's own frame: the identity for a page,
 * the inverse of a frame's page transform for a frame), page x along +X and page y along −Y,
 * facing +Z. Corners top left, top right, bottom right, bottom left; (0, 0) is the picture's top
 * left.
 */
export function quad(box: { x: number; y: number; w: number; h: number }, toOrigin: Affine = IDENTITY) {
  const corners: [number, number][] = [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x + box.w, box.y + box.h],
    [box.x, box.y + box.h],
  ];
  const positions: number[] = [];
  for (const [x, y] of corners) {
    const [lx, ly] = apply(toOrigin, x, y);
    positions.push(lx * METRES_PER_UNIT, -ly * METRES_PER_UNIT, 0);
  }
  // a reflection in toOrigin would turn the quad over; tldraw's page transforms don't reflect
  return {
    positions,
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    // counter-clockwise seen from +Z
    indices: [0, 3, 2, 0, 2, 1],
  };
}
