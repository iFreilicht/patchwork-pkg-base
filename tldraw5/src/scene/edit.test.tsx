import { describe, it, expect, vi, beforeEach } from "vitest";

// the tool and tldraw load as a drawing opens; here they're stand-ins
const rendered: { handle: unknown; element: HTMLElement; host: any; unmount: ReturnType<typeof vi.fn> }[] = [];
vi.mock("../tool.tsx", () => ({
  render: (handle: unknown, element: HTMLElement, host: unknown) => {
    const unmount = vi.fn();
    rendered.push({ handle, element, host, unmount });
    return unmount;
  },
}));
vi.mock("@tldraw/tldraw", () => ({
  // tldraw's reaction: run now; the tests call sync again by hand
  react: (_name: string, fn: () => void) => {
    fn();
    return vi.fn();
  },
}));

const { create, SOURCE_ID } = await import("./edit.tsx");

const flush = () => new Promise((r) => setTimeout(r, 0));
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function setup({ objects, renderParams = {}, store }: { objects?: Record<string, object>; renderParams?: Record<string, unknown>; store?: Record<string, object> } = {}) {
  const port = document.createElement("div");
  document.body.append(port);
  const overlay = document.createElement("div");
  port.append(overlay);
  const calls: string[] = [];
  const docs: Record<string, unknown> = {
    "automerge:drawing": { store: store ?? { "page:a": { id: "page:a", typeName: "page", index: "a1", name: "A" } } },
    "automerge:render": { params: renderParams },
  };
  const abort = new AbortController();
  const stage = {
    signal: abort.signal,
    repo: { find: async (url: string) => ({ url, doc: () => docs[url] }) },
    scene: () => ({ objects: objects ?? { d: { providerId: SOURCE_ID, sourceUrl: "automerge:drawing", renderUrl: "automerge:render", name: "Notes" }, box: { providerId: "other" } } }),
    display: vi.fn((id: string, o: object) => (calls.push(`display ${id} ${JSON.stringify(o)}`), () => calls.push(`show ${id}`))),
    worldOf: () => IDENTITY,
    camera: {
      get: () => ({ fov: 45 }),
      set: vi.fn(),
      hold: vi.fn(() => (calls.push("hold"), () => calls.push("release"))),
    },
  };
  let hand: any = null;
  const api = {
    focus: () => stage,
    overlay: () => overlay,
    hand: vi.fn((spec: any) => ((hand = spec), calls.push(`hand ${spec.name}`), () => calls.push("put down"))),
  };
  const prepare = vi.fn(async () => {});
  const plugin = create(api as never, prepare);
  const open = plugin.commands[0];
  return { plugin, open, stage, api, overlay, calls, abort, prepare, hand: () => hand };
}

/** An editor as the host sees it, idle in its select tool unless told otherwise. */
function fakeEditor({ busy = false } = {}) {
  return {
    setCurrentPage: vi.fn(),
    zoomToFit: vi.fn(),
    zoomToBounds: vi.fn(),
    getShapePageBounds: vi.fn(() => ({ x: 0, y: 0, w: 100, h: 100 })),
    getShapePageTransform: vi.fn(() => ({ a: 1, b: 0, c: 0, d: 1, e: 100, f: 50 })),
    getCamera: () => ({ x: 0, y: 0, z: 1 }),
    getViewportScreenBounds: () => ({ w: 800, h: 600 }),
    getCurrentToolId: () => (busy ? "draw" : "select"),
    isIn: () => !busy,
    getSelectedShapeIds: () => [],
    getEditingShapeId: () => null,
    hasAncestor: (shape: { parentId?: string }, id: string) => shape.parentId === id,
  };
}

beforeEach(() => {
  rendered.length = 0;
  document.body.replaceChildren();
});

describe("the drawing's Open", () => {
  it("is an Open of drawings only, run only while editing, and not of one fixed at a version", () => {
    const { open } = setup();
    expect(open).toMatchObject({ open: true, edit: true, key: "Enter" });
    expect(open.state("d")).toMatchObject({ label: "Open" });
    expect(open.state("box")).toBeNull();
    expect(open.state(null)).toBeNull();
    const fixed = setup({ objects: { d: { providerId: SOURCE_ID, sourceUrl: "automerge:drawing", at: { heads: ["h"] } } } });
    expect(fixed.open.state("d")).toMatchObject({ disabled: true });
  });

  it("lays the tool over the scene as an embedded document, hides the built picture, holds the camera and takes a hand", async () => {
    const { open, overlay, calls, prepare } = setup();
    open.run("d");
    await flush();
    const element = overlay.querySelector(".tldraw5-scene-edit") as HTMLElement & { repo?: unknown };
    expect(element.hasAttribute("data-stage-embed")).toBe(true);
    expect(element.classList.contains("about-embed")).toBe(true);
    expect(element.repo).toBeTruthy();
    expect(overlay.querySelector(".tldraw5-scene-done")?.textContent).toBe("Done");
    expect(calls).toEqual(['display d {"hidden":true}', "hold", "hand Editing Notes"]);
    expect(prepare).toHaveBeenCalledOnce();
    expect(rendered).toHaveLength(1);
    expect(rendered[0].element).toBe(element);
    expect(rendered[0].host.getShapeVisibility).toBeUndefined();
    expect(open.state("d")).toMatchObject({ label: "Close", checked: true });
  });

  it("shows the page the placement chose, fitted, and puts the scene's camera face on to it", async () => {
    const store = { "page:a": { id: "page:a", typeName: "page", index: "a1", name: "A" }, "page:b": { id: "page:b", typeName: "page", index: "a2", name: "B" } };
    const { open, stage } = setup({ store, renderParams: { show: "page:b" } });
    open.run("d");
    await flush();
    const editor = fakeEditor();
    rendered[0].host.onEditor(editor);
    expect(editor.setCurrentPage).toHaveBeenCalledWith("page:b");
    expect(editor.zoomToFit).toHaveBeenCalledOnce();
    const cam = stage.camera.set.mock.calls.at(-1)![0];
    // the middle of tldraw's view, (400, 300) on the page, straight ahead; looking down −z at an upright drawing
    expect(cam.target.map((v: number) => v / (0.0254 / 96))).toEqual([expect.closeTo(400, 6), expect.closeTo(-300, 6), 0]);
    expect(cam.position[2]).toBeGreaterThan(0);
    expect(cam.quaternion.map((v: number) => v + 0)).toEqual([0, 0, 0, 1]);
  });

  it("edits a frame shown alone: zoomed to it, what's outside it hidden", async () => {
    const store = {
      "page:a": { id: "page:a", typeName: "page", index: "a1", name: "A" },
      "shape:f": { id: "shape:f", typeName: "shape", type: "frame", parentId: "page:a", index: "a1", props: { name: "Plan" } },
    };
    const { open } = setup({ store, renderParams: { show: "shape:f" } });
    open.run("d");
    await flush();
    const host = rendered[0].host;
    const editor = fakeEditor();
    expect(host.getShapeVisibility({ id: "shape:f", parentId: "page:a" }, editor)).toBe("inherit");
    expect(host.getShapeVisibility({ id: "shape:in", parentId: "shape:f" }, editor)).toBe("inherit");
    expect(host.getShapeVisibility({ id: "shape:out", parentId: "page:a" }, editor)).toBe("hidden");
    host.onEditor(editor);
    expect(editor.setCurrentPage).toHaveBeenCalledWith("page:a");
    expect(editor.zoomToBounds).toHaveBeenCalledWith({ x: 0, y: 0, w: 100, h: 100 }, { inset: 64 });
  });

  it("ends on Escape when tldraw has nothing to cancel, and leaves Escape to tldraw when it has", async () => {
    for (const busy of [true, false]) {
      const { open, overlay, calls } = setup();
      open.run("d");
      await flush();
      const { element, host, unmount } = rendered.at(-1)!;
      const off = host.onEditor(fakeEditor({ busy }));
      const key = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      element.dispatchEvent(key);
      if (busy) {
        expect(key.defaultPrevented).toBe(false);
        expect(overlay.querySelector(".tldraw5-scene-edit")).not.toBeNull();
        continue;
      }
      expect(key.defaultPrevented).toBe(true);
      off();
      // everything it took, given back, last first
      expect(unmount).toHaveBeenCalledOnce();
      expect(calls.slice(3)).toEqual(["put down", "release", "show d"]);
      expect(overlay.querySelector(".tldraw5-scene-edit")).toBeNull();
      expect(overlay.querySelector(".tldraw5-scene-done")).toBeNull();
      expect(open.state("d")).toMatchObject({ label: "Open" });
    }
  });

  it("ends by Done, by its Open again, by putting its hand down, and as the focus leaves", async () => {
    const ends: [string, (s: ReturnType<typeof setup>) => void][] = [
      ["Done", (s) => (s.overlay.querySelector(".tldraw5-scene-done") as HTMLButtonElement).click()],
      ["Close", (s) => s.open.run("d")],
      ["the hand", (s) => s.hand().put()],
      ["the focus", (s) => s.abort.abort()],
    ];
    for (const [, end] of ends) {
      const s = setup();
      s.open.run("d");
      await flush();
      end(s);
      expect(s.calls.at(-1)).toBe("show d");
      expect(s.plugin.inspect().editing).toBeNull();
    }
  });

  it("ends before the tool mounts if closed while it loads", async () => {
    const s = setup();
    s.open.run("d");
    s.open.run("d");
    await flush();
    expect(rendered).toHaveLength(0);
    expect(s.overlay.querySelector(".tldraw5-scene-edit")).toBeNull();
  });
});
