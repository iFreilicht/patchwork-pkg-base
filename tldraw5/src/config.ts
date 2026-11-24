import type { Repo } from "@automerge/automerge-repo/slim";
import {
  defaultShapeUtils,
  defaultBindingUtils,
  defaultAssetUtils,
  defaultOverlayUtils,
  defaultTools,
} from "@tldraw/tldraw";
import type { DocLink } from "@inkandswitch/patchwork-filesystem";
import type { TldrawConfig } from "./script.ts";
import { DiffShapeWrapper } from "./DiffShapeWrapper.tsx";
import { PatchworkDocShapeUtil } from "./PatchworkDocShape.tsx";
import { NewDocShapeTool, NewDocToolbar } from "./NewDocTool.tsx";
import { TldrFileMainMenu } from "./file-io.tsx";

// Custom shapes / tools that let a tldraw canvas embed other Patchwork
// documents. These must be registered both on the Automerge-backed store (so
// the shape type persists) and on the <Tldraw> component (so it renders).
const customShapeUtils = [PatchworkDocShapeUtil];
const customTools = [NewDocShapeTool];

/** What a canvas is made of before a document's `config.js` adds to it. */
export function baseConfig(): TldrawConfig {
  return {
    shapeUtils: [...defaultShapeUtils, ...customShapeUtils],
    bindingUtils: [...defaultBindingUtils],
    assetUtils: [...defaultAssetUtils],
    overlayUtils: [...defaultOverlayUtils],
    tools: [...defaultTools, ...customTools],
    components: {
      ShapeWrapper: DiffShapeWrapper,
      Toolbar: NewDocToolbar,
      MainMenu: TldrFileMainMenu,
    },
    options: {},
  };
}

/**
 * The config a document's canvas is built from, once: its `config.js` run on
 * the base config, or the base config alone when it has none. A script that
 * fails leaves the base config, as the tool does. The tool follows the
 * script's edits instead (`useScriptConfig` in tool.tsx).
 */
export async function loadConfig(
  repo: Repo,
  docs: DocLink[] | undefined
): Promise<{ config: TldrawConfig; dispose: () => void }> {
  if (!docs?.length) return { config: baseConfig(), dispose: () => {} };
  const { readScriptTree, runConfigScript } = await import("./script.ts");
  try {
    const tree = await readScriptTree(repo, docs);
    const { config, dispose } = await runConfigScript(repo, tree.files, baseConfig());
    return { config, dispose };
  } catch (error) {
    console.error("[tldraw5] config script failed", error);
    return { config: baseConfig(), dispose: () => {} };
  }
}
