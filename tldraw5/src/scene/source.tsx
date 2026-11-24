// A tldraw drawing as scene content (patchwork-experiments/scene, README "Writing a provider"):
// the page or frame a placement chooses (its `show` param, ./choices.ts), exported as a picture on
// a transparent background in tldraw's light colours, on a quad in the object's frame; a scene
// recolours it for a viewer in a dark scheme (its material's `extras.colorScheme`). The canvas
// is the tool's own: the base config and the document's `config.js` (../config.ts), so its custom
// shapes draw as they do in the tool. Built on the main thread, by a hidden editor.

import type { Repo } from "@automerge/automerge-repo/slim";
import {
  Box,
  Tldraw,
  createTLStore,
  type Editor,
  type TLAnyBindingUtilConstructor,
  type TLAnyShapeUtilConstructor,
  type TLPageId,
  type TLShapeId,
  type TldrawProps,
} from "@tldraw/tldraw";
import { createRoot } from "react-dom/client";
import type { TLDrawDoc } from "../datatype.ts";
import { loadConfig } from "../config.ts";
import type { TldrawConfig } from "../script.ts";
import { IDENTITY, SHOW, invert, quad, resolveShow, showSpec } from "./choices.ts";
import { computeBounds, encodeGLB } from "./glb.js";

/**
 * Page units of margin around a page's shapes: strokes, arrowheads and frames' labels reach past
 * their bounds. A frame shown alone has none: tldraw exports it clipped to itself, without its
 * label or border, so its picture is exactly the frame, its top left corner at the origin.
 */
const MARGIN = 48;
/** The longest side of a picture, in pixels: every WebGL device takes a texture this large. */
const MAX_PIXELS = 4096;
/** Pixels per page unit, at most: tldraw's own default for bitmap exports. */
const PIXEL_RATIO = 2;
/** How long the hidden editor may take to start. */
const MOUNT_MS = 20_000;

type Built = { kind: "glb"; glb: Uint8Array; meta: { bounds?: { min: number[]; max: number[] }; notes?: string } };

/** The tool's canvas, mounted hidden and without UI, for as long as `use` runs. */
async function withEditor<T>(doc: TLDrawDoc, config: TldrawConfig, use: (editor: Editor) => Promise<T>): Promise<T> {
  const shapeUtils = config.shapeUtils as TLAnyShapeUtilConstructor[];
  const bindingUtils = config.bindingUtils as TLAnyBindingUtilConstructor[];
  const store = createTLStore({ shapeUtils, bindingUtils });
  store.loadStoreSnapshot({ store: structuredClone(doc.store), schema: structuredClone(doc.schema) } as never);
  // in the page, so that text measures as it does in the tool; never seen
  const host = document.createElement("div");
  host.style.cssText = "position: fixed; left: -100000px; top: 0; width: 1024px; height: 768px; opacity: 0; pointer-events: none;";
  host.setAttribute("aria-hidden", "true");
  document.body.append(host);
  const root = createRoot(host);
  try {
    const editor = await new Promise<Editor>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the drawing's editor didn't start")), MOUNT_MS);
      root.render(
        <Tldraw
          store={store}
          shapeUtils={shapeUtils}
          bindingUtils={bindingUtils}
          assetUtils={config.assetUtils as TldrawProps["assetUtils"]}
          overlayUtils={config.overlayUtils as TldrawProps["overlayUtils"]}
          options={config.options as TldrawProps["options"]}
          colorScheme="light"
          hideUi
          autoFocus={false}
          onMount={(e) => {
            clearTimeout(timer);
            e.updateInstanceState({ isReadonly: true });
            resolve(e);
          }}
        />
      );
    });
    return await use(editor);
  } finally {
    root.unmount();
    host.remove();
    store.dispose();
  }
}

/** The chosen page or frame as a PNG, the page rectangle it covers, and the map from the page to its origin. */
async function picture(editor: Editor, shown: { page: string; frame: string | null }) {
  editor.setCurrentPage(shown.page as TLPageId);
  const ids = shown.frame ? [shown.frame as TLShapeId] : editor.getSortedChildIdsForParent(shown.page as TLPageId);
  const bounds = ids.length ? editor.getShapesPageBounds(ids) : null;
  if (!bounds) return null;
  const margin = shown.frame ? 0 : MARGIN;
  const box = new Box(bounds.x - margin, bounds.y - margin, bounds.w + 2 * margin, bounds.h + 2 * margin);
  await editor.fonts.loadRequiredFontsForCurrentPage();
  const pixelRatio = Math.min(PIXEL_RATIO, MAX_PIXELS / Math.max(box.w, box.h));
  const { blob } = await editor.toImage(ids, { format: "png", background: false, darkMode: false, bounds: box, padding: 0, scale: 1, pixelRatio });
  const toOrigin = shown.frame ? invert(editor.getShapePageTransform(shown.frame as TLShapeId)) : IDENTITY;
  return { png: new Uint8Array(await blob.arrayBuffer()), box, toOrigin, pixels: [Math.round(box.w * pixelRatio), Math.round(box.h * pixelRatio)] };
}

export default {
  /** The scene's `params(doc)`: what a placement shows, of this document's pages and frames. */
  params(doc: TLDrawDoc) {
    const spec = showSpec(doc?.store as never);
    return spec ? [spec] : [];
  },

  /**
   * The other documents the build reads: the script tree's top-level links (`config.js` and the
   * folders around it), so editing them rebuilds. A file in a nested folder is read too, but only
   * its folder is watched, which moves when the folder's list does, not when the file is edited.
   */
  dependencies(doc: TLDrawDoc) {
    return (doc?.docs ?? []).map((link) => link.url).filter((url): url is NonNullable<typeof url> => typeof url === "string" && !!url);
  },

  async build({ doc, repo, params }: { doc: TLDrawDoc; repo: Repo; params: Record<string, unknown> }): Promise<Built> {
    const shown = resolveShow(doc?.store as never, params[SHOW]);
    if (!shown) return { kind: "glb", glb: encodeGLB({ meshes: [] }), meta: { notes: "The drawing has no pages." } };
    const { config, dispose } = await loadConfig(repo, doc.docs);
    try {
      const pic = await withEditor(doc, config, (editor) => picture(editor, shown));
      if (!pic) return { kind: "glb", glb: encodeGLB({ meshes: [] }), meta: { notes: `Nothing drawn on ${shown.name}.` } };
      const q = quad(pic.box, pic.toOrigin);
      const glb = encodeGLB({
        meshes: [{ name: shown.name, primitives: [{ ...q, texture: { image: pic.png, mimeType: "image/png" }, blend: true, unlit: true, materialExtras: { colorScheme: "light" } }] }],
        nodes: [{ name: shown.name, mesh: 0 }],
        generator: "tldraw5 scene source",
      });
      const bounds = computeBounds(q.positions);
      return { kind: "glb", glb, meta: { ...(bounds ? { bounds } : {}), notes: `${shown.name}, ${pic.pixels[0]} × ${pic.pixels[1]} px` } };
    } finally {
      dispose();
    }
  },
};
