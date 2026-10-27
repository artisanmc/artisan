import { getTextureUrl } from "@/features/canvas/textureStore";
import { useMemo, useState } from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { path, tween } from "../kit/anim";
import { menuBox, withElements } from "../kit/board";
import { Caption } from "../kit/Caption";
import { Cursor } from "../kit/Cursor";
import { cameraOn, primeCamera, domCenter, hover, select, setCamera, slotCenter, useDrive, useMeasure } from "../kit/drive";
import { INSPECTOR_W, LIBRARY_W, Workspace } from "../kit/Workspace";
import { baseProject, showProject } from "../setup";

// Le sélecteur de serveurs se remplit : un objet glissé depuis la bibliothèque,
// les autres posés ensuite, puis l'infobulle telle qu'en jeu.
const MENU = "servers";
const LAYER = "servers";
const ROWS = 5;
const SEARCH = "grass";
const DROP = 96;
const LATER: [number, string][] = [
  [118, "skyblock"],
  [130, "creative"],
  [142, "events"],
  [154, "shop"],
];
const HOVER = 190;

function typedSearch(frame: number) {
  const n = Math.floor((frame - 10) / 4);
  return frame < 10 ? "" : SEARCH.slice(0, Math.max(0, Math.min(SEARCH.length, n + 1)));
}

/** Pose la valeur de la recherche comme le ferait la frappe au clavier. */
function setSearch(value: string) {
  const input = document.querySelector<HTMLInputElement>("input[placeholder^='Search']");
  if (!input || input.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function Design() {
  const { width, height } = useVideoConfig();
  const variants = useMemo(() => {
    const keep = (ids: string[]) => withElements(baseProject, MENU, LAYER, ["profile", ...ids]);
    return [keep([]), keep(["survival"]), ...LATER.map((_, i) => keep(["survival", ...LATER.slice(0, i + 1).map(([, id]) => id)]))];
  }, []);
  const view = { width: width - LIBRARY_W - INSPECTOR_W, height };
  const camera = cameraOn(menuBox(baseProject, MENU), view, 1.45);

  useState(() => primeCamera(baseProject.id, camera));
  const frame = useDrive((f) => {
    const added = f < DROP ? 0 : 1 + LATER.filter(([at]) => f >= at).length;
    showProject(variants[added] ?? baseProject);
    setCamera(camera);
    setSearch(typedSearch(f));
    if (f >= DROP) select(["survival"], 20, MENU);
    else select([]);
  });
  const targets = useMeasure(() => {
    const search = domCenter("input[placeholder^='Search']");
    const tile = domCenter("[title='Grass Block']");
    const slot = slotCenter(MENU, 20, ROWS);
    return search && slot ? { search, tile: tile ?? search, slot } : null;
  });
  useDrive((f) => {
    hover(f >= HOVER && targets ? { elementId: "survival", menuId: MENU, slot: 20, at: { x: targets.slot.x + 18, y: targets.slot.y + 18 } } : null);
  }, [targets]);

  const cursor = targets
    ? path(frame, [
        [0, { x: width * 0.45, y: height * 0.75 }],
        [8, targets.search],
        [44, targets.search],
        [58, targets.tile],
        [62, targets.tile],
        [DROP - 4, targets.slot],
        [DROP + 20, { x: targets.slot.x + 60, y: targets.slot.y + 140 }],
        [HOVER - 6, targets.slot],
      ])
    : { x: width * 0.45, y: height * 0.75 };
  const dragging = frame >= 62 && frame < DROP - 2;

  return (
    <AbsoluteFill>
      <Workspace projectId={baseProject.id} inspector={tween(frame, [DROP - 6, DROP + 12], [0, 1])} />
      <Cursor
        frame={frame}
        at={cursor}
        clicks={[8, 60, DROP - 2]}
        carrying={dragging ? getTextureUrl("GRASS_BLOCK") : null}
      />
      <Caption frame={frame} start={150} end={300} title="Design it. See it." accent="See it." sub="Your menu, exactly as players will see it." />
    </AbsoluteFill>
  );
}
