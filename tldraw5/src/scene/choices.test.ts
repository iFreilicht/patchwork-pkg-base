import { describe, it, expect } from "vitest";
import { METRES_PER_UNIT, framesOf, invert, pagesOf, quad, resolveShow, showSpec, type Affine } from "./choices.ts";

// records as a tldraw5 document keeps them: pages, and shapes under a page or a frame
const page = (id: string, index: string, name: string) => ({ id, typeName: "page", index, name, meta: {} });
const shape = (id: string, parentId: string, index: string, type = "geo", name?: string) => ({ id, typeName: "shape", type, parentId, index, x: 0, y: 0, rotation: 0, props: name === undefined ? {} : { name } });
const storeOf = (...recs: { id: string }[]) => Object.fromEntries(recs.map((r) => [r.id, r]));

describe("the pages and frames a placement can show", () => {
  it("lists pages in tldraw's order, and a page's frames depth first in drawing order, with the frames they're in", () => {
    const store = storeOf(
      page("page:b", "a2", "Second"),
      page("page:a", "a1", "First"),
      shape("shape:f2", "page:a", "a3", "frame", "Later"),
      shape("shape:f1", "page:a", "a1", "frame", "Plan"),
      shape("shape:in", "shape:f1", "a1", "frame", "Detail"),
      shape("shape:geo", "shape:f1", "a0"),
      shape("shape:f3", "page:b", "a1", "frame", "")
    );
    expect(pagesOf(store).map((p) => p.id)).toEqual(["page:a", "page:b"]);
    expect(framesOf(store, "page:a")).toEqual([
      { id: "shape:f1", path: ["Plan"] },
      { id: "shape:in", path: ["Plan", "Detail"] },
      { id: "shape:f2", path: ["Later"] },
    ]);
    expect(framesOf(store, "page:b")).toEqual([{ id: "shape:f3", path: ["Frame"] }]);
  });

  it("with one page: the whole page first, then its frames, no groups; the page by default", () => {
    const spec = showSpec(storeOf(page("page:p", "a1", "Page 1"), shape("shape:f", "page:p", "a1", "frame", "Plan")));
    expect(spec).toEqual({
      key: "show",
      label: "Show",
      kind: "enum",
      default: "page:p",
      options: [
        { value: "page:p", label: "Whole page" },
        { value: "shape:f", label: "Plan" },
      ],
    });
  });

  it("with several pages: each page's entries under its name, a shared name told apart", () => {
    const spec = showSpec(storeOf(page("page:a", "a1", "Sheet"), page("page:b", "a2", "Sheet"), shape("shape:f", "page:b", "a1", "frame", "Plan")));
    expect(spec?.default).toBe("page:a");
    expect(spec?.options).toEqual([
      { value: "page:a", label: "Whole page", group: "Sheet" },
      { value: "page:b", label: "Whole page", group: "Sheet (2)" },
      { value: "shape:f", label: "Plan", group: "Sheet (2)" },
    ]);
  });

  it("offers nothing for a document without pages", () => {
    expect(showSpec({})).toBeNull();
    expect(showSpec(undefined)).toBeNull();
  });

  it("resolves a page, a frame with its page (however deep), and anything else as the first page", () => {
    const store = storeOf(page("page:a", "a1", "A"), page("page:b", "a2", "B"), shape("shape:f", "page:b", "a1", "frame", "Plan"), shape("shape:g", "shape:f", "a1", "frame", "Inner"), shape("shape:geo", "page:b", "a2"));
    expect(resolveShow(store, "page:b")).toEqual({ page: "page:b", frame: null, name: "B" });
    expect(resolveShow(store, "shape:g")).toEqual({ page: "page:b", frame: "shape:g", name: "Inner" });
    expect(resolveShow(store, "shape:geo")).toEqual({ page: "page:a", frame: null, name: "A" });
    expect(resolveShow(store, "shape:gone")).toEqual({ page: "page:a", frame: null, name: "A" });
    expect(resolveShow(store, undefined)).toEqual({ page: "page:a", frame: null, name: "A" });
    expect(resolveShow({}, "page:a")).toBeNull();
  });
});

describe("the quad a picture lies on", () => {
  const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));

  it("puts a page rectangle at the page's origin: page x along +X, page y along −Y, at printed size", () => {
    const q = quad({ x: 96, y: 0, w: 96, h: 192 });
    // 96 page units are an inch
    near(q.positions, [0.0254, 0, 0, 0.0508, 0, 0, 0.0508, -0.0508, 0, 0.0254, -0.0508, 0]);
    expect(q.uvs).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
    expect(METRES_PER_UNIT * 96).toBeCloseTo(0.0254, 12);
  });

  it("faces +Z: its triangles turn counter-clockwise seen from there", () => {
    const q = quad({ x: 0, y: 0, w: 10, h: 10 });
    for (let t = 0; t < q.indices.length; t += 3) {
      const [a, b, c] = q.indices.slice(t, t + 3).map((i) => q.positions.slice(i * 3, i * 3 + 2));
      const z = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      expect(z).toBeGreaterThan(0);
    }
  });

  it("puts a frame's top left corner at the origin, along the frame's axes, through its inverted page transform", () => {
    // a frame at (100, 50) on the page, turned a quarter turn clockwise on the screen (tldraw's y is down)
    const frame: Affine = { a: 0, b: 1, c: -1, d: 0, e: 100, f: 50 };
    const toOrigin = invert(frame);
    // the frame's own (10, 20) is the page's (80, 60): back at (10, 20) in the frame
    const q = quad({ x: 80, y: 60, w: 0, h: 0 }, toOrigin);
    near(q.positions.slice(0, 3), [10 * METRES_PER_UNIT, -20 * METRES_PER_UNIT, 0]);
  });

  it("inverts an affine map", () => {
    const m: Affine = { a: 2, b: 0.5, c: -1, d: 3, e: 7, f: -4 };
    const i = invert(m);
    const x = 3;
    const y = -2;
    const px = m.a * x + m.c * y + m.e;
    const py = m.b * x + m.d * y + m.f;
    expect(i.a * px + i.c * py + i.e).toBeCloseTo(x, 12);
    expect(i.b * px + i.d * py + i.f).toBeCloseTo(y, 12);
  });
});
