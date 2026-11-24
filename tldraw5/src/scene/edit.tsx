// Editing a drawing where it stands in a 3D scene (`scene:view` "tldraw5-scene-edit";
// patchwork-experiments/scene, EDITOR.md "A command", STAGE.md "View plugins"). The drawing's Open
// (the inspector's button, the menu, a double-click or Enter in Edit) lays the tool itself, with
// its UI, over the scene's view, on a transparent background, and hides the object's built picture.
// tldraw's camera leads: the scene's camera follows it, orthographic and face on to the drawing's plane, so that the
// page lies on the screen as tldraw draws it (./face-on.ts) and panning or zooming in tldraw moves
// the scene with it. A frame shown alone is edited alone. Escape with nothing to cancel in tldraw,
// Done, the Open again or the focus leaving ends it.
//
// Only this module loads with every scene view: tldraw and the tool load as a drawing is opened.

import type { Editor, TLShape, TLShapeId } from "@tldraw/tldraw";
import type { CanvasHost } from "../tool.tsx";
import { IDENTITY, SHOW, invert, resolveShow, type Affine } from "./choices.ts";
import { faceOn } from "./face-on.ts";

/** The scene source whose objects this edits (main.ts). */
export const SOURCE_ID = "tldraw5-scene";
/** The scene's marks for a document embedded in it: its keys and drops are its own, and the scene's styles stop at it (scene's embed.js). */
const EMBED_ATTR = "data-stage-embed";
const EMBED_CLASS = "about-embed";

const STYLE = `
.tldraw5-scene-edit { position: absolute; inset: 0; }
.tldraw5-scene-edit .tl-background { display: none; }
.tldraw5-scene-edit .tl-container { background: transparent !important; }
.tldraw5-scene-done { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 1000;
  padding: 4px 14px; border-radius: 6px; border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
  background: Canvas; color: CanvasText; font: 500 13px system-ui, sans-serif; cursor: pointer; }
`;

type Projection = "perspective" | "orthographic";
type Camera = { get(): { fov?: number; projection?: Projection } | null; set(cam: { position?: number[]; quaternion?: number[]; target?: number[]; projection?: Projection }): void; hold(): () => void };
type Handle = { url: string; doc(): unknown };
/** The parts of the scene's api this uses: its focus stage's (`api.focus()`), all in that stage's frame. */
type Stage = {
  signal: AbortSignal;
  repo: { find(url: string): Promise<Handle> };
  writable(): boolean;
  scene(): { objects: Record<string, { providerId?: string; sourceUrl?: string; renderUrl?: string | null; name?: string; at?: unknown } | undefined> };
  display(id: string, o: { hidden?: boolean }): () => void;
  worldOf(id: string): ArrayLike<number> | null;
  camera: Camera;
};
type ViewApi = {
  /** The view's own repo: the tool's hooks need a whole one, which a stage's (find, create) isn't. */
  repo: unknown;
  focus(): Stage | null;
  overlay(): HTMLElement;
  hand(spec: { kind: string; name: string; input: object; pointer?: boolean; escape?: () => boolean; put?: () => void }): () => void;
};

type Session = { id: string; stop(): void; sync(): void };

/**
 * The scene's camera, following tldraw's: face on to the drawing, the page where tldraw draws it.
 * @returns what stops it
 */
function follow(editor: Editor, stage: Stage, id: string, toOrigin: Affine, react: (name: string, fn: () => void) => () => void, set: (sync: () => void) => void) {
  let last = "";
  const sync = () => {
    const matrix = stage.worldOf(id);
    const viewport = editor.getViewportScreenBounds();
    if (!matrix || !(viewport.w > 0 && viewport.h > 0)) return;
    const fov = stage.camera.get()?.fov ?? 50;
    const { position, quaternion, target } = faceOn({ matrix, toOrigin, camera: editor.getCamera(), viewport, fov });
    // the scene asks again on every flush: set it only when it moves
    const key = [...position, ...quaternion].map((v) => v.toPrecision(9)).join(",");
    if (key === last) return;
    last = key;
    stage.camera.set({ position, quaternion, target });
  };
  set(sync);
  // tldraw's camera and viewport are signals: following them, the scene moves with every pan, zoom and resize
  return react("the scene's camera follows tldraw's", () => {
    editor.getCamera();
    editor.getViewportScreenBounds();
    sync();
  });
}

export function create(api: ViewApi, prepare: () => Promise<void> = async () => {}) {
  const overlay = api.overlay();
  let session: Session | undefined;
  let styled = false;

  function start(stage: Stage, id: string) {
    session?.stop();
    const object = stage.scene().objects[id];
    if (!object?.sourceUrl) return;
    let stopped = false;
    const cleanups: (() => void)[] = [];
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (session === current) session = undefined;
      for (const done of cleanups.splice(0).reverse()) {
        try {
          done();
        } catch (error) {
          console.warn("[tldraw5] ending the scene's editing", error);
        }
      }
    };
    const current: Session = { id, stop, sync: () => {} };
    session = current;

    if (!styled) {
      const style = document.createElement("style");
      style.textContent = STYLE;
      overlay.append(style);
      styled = true;
    }
    // the tool's hooks take a whole repo (findWithProgress and the rest): the view's. Its handles
    // write, so Open is offered only where the stage may write (the command's state)
    const element = Object.assign(document.createElement("div"), { className: `${EMBED_CLASS} tldraw5-scene-edit`, repo: api.repo });
    element.setAttribute(EMBED_ATTR, "");
    const done = Object.assign(document.createElement("button"), { type: "button", className: "tldraw5-scene-done", textContent: "Done", title: "Stop editing the drawing (Escape)" });
    done.addEventListener("click", stop);
    overlay.append(element, done);
    cleanups.push(() => element.remove(), () => done.remove());
    cleanups.push(stage.display(id, { hidden: true }));
    cleanups.push(stage.camera.hold());
    // Orthographic while editing, as a drawing is flat: the scene behind it shows without
    // perspective, as the page does. faceOn holds for both (the scene's orthographic view shows at
    // the focus what perspective shows there). The viewer's own choice comes back as it ends,
    // while the camera is still held, so the switch is never kept as theirs.
    const projection = stage.camera.get()?.projection;
    stage.camera.set({ projection: "orthographic" });
    cleanups.push(() => stage.camera.set({ projection: projection ?? "perspective" }));
    cleanups.push(api.hand({ kind: "tldraw", name: `Editing ${object.name ?? "drawing"}`, pointer: true, input: {}, escape: () => false, put: stop }));
    stage.signal.addEventListener("abort", stop, { once: true });

    void (async () => {
      try {
        await prepare();
        const [{ render }, { react }, handle, renderDoc] = await Promise.all([
          import("../tool.tsx"),
          import("@tldraw/tldraw"),
          stage.repo.find(object.sourceUrl!),
          object.renderUrl ? stage.repo.find(object.renderUrl).then((h) => h.doc() as { params?: Record<string, unknown> } | undefined) : undefined,
        ]);
        if (stopped) return;
        const store = (handle.doc() as { store?: Record<string, unknown> } | undefined)?.store;
        const shown = resolveShow(store, renderDoc?.params?.[SHOW]);
        if (!shown) return stop();
        const frame = shown.frame as TLShapeId | null;
        const host: CanvasHost = {
          onEditor(editor) {
            editor.setCurrentPage(shown.page as never);
            const bounds = frame ? editor.getShapePageBounds(frame) : null;
            if (bounds) editor.zoomToBounds(bounds, { inset: 64 });
            else editor.zoomToFit();
            // the frame's origin as the build placed it; a frame moved meanwhile lands there at the next build
            const toOrigin = frame ? invert(editor.getShapePageTransform(frame)) : IDENTITY;
            const unfollow = follow(editor, stage, id, toOrigin, react, (sync) => (current.sync = sync));
            // Escape with nothing to cancel in tldraw (looked at before tldraw takes it) ends the editing
            const onKey = (e: KeyboardEvent) => {
              if (e.key !== "Escape") return;
              const idle = editor.getCurrentToolId() === "select" && editor.isIn("select.idle") && !editor.getSelectedShapeIds().length && !editor.getEditingShapeId();
              if (!idle) return;
              e.preventDefault();
              e.stopPropagation();
              stop();
            };
            element.addEventListener("keydown", onKey, true);
            return () => {
              unfollow();
              element.removeEventListener("keydown", onKey, true);
              current.sync = () => {};
            };
          },
        };
        // a frame shown alone is edited alone: what's outside it is hidden
        if (frame) host.getShapeVisibility = (shape: TLShape, editor: Editor) => (shape.id === frame || editor.hasAncestor(shape, frame) ? "inherit" : "hidden");
        cleanups.push(render(handle, element, host));
      } catch (error) {
        console.warn("[tldraw5] couldn't open the drawing in the scene", error);
        stop();
      }
    })();
  }

  const isDrawing = (target: unknown) => typeof target === "string" && api.focus()?.scene().objects[target]?.providerId === SOURCE_ID;

  return {
    commands: [
      {
        // the drawing's Open (scene EDITOR.md, "A command"): tldraw, in place; double-click and Enter run it too
        id: "tldraw5-edit",
        name: "Open",
        open: true,
        key: "Enter",
        edit: true,
        show: ["menu", "inspector"],
        state(target: unknown) {
          if (!isDrawing(target)) return null;
          const open = session?.id === target;
          const stage = api.focus();
          if (!open && stage?.scene().objects[target as string]?.at) return { label: "Open", title: "Fixed at a version: follow the latest to edit it", disabled: true };
          if (!open && stage && !stage.writable()) return { label: "Open", title: "This scene can't be changed here", disabled: true };
          return { label: open ? "Close" : "Open", title: open ? "Stop editing the drawing" : "Edit the drawing here, in place", checked: open };
        },
        run(target: unknown) {
          const stage = api.focus();
          if (!stage || !isDrawing(target)) return;
          if (session && session.id === target) session.stop();
          else start(stage, target as string);
        },
      },
    ],
    /** The scene changed (the drawing moved, say): put the camera where the page now is. */
    update() {
      session?.sync();
    },
    dispose() {
      session?.stop();
    },
    /** For probes and tests: which object is being edited. */
    inspect: () => ({ editing: session?.id ?? null }),
  };
}

export default { create };
