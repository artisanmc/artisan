import { useState } from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { type Point, path, tween } from "../kit/anim";
import { menuBox, unionBox } from "../kit/board";
import { Caption } from "../kit/Caption";
import { Cursor } from "../kit/Cursor";
import { cameraOn, primeCamera, hover, mixCamera, select, setCamera, slotCenter, useDrive, useMeasure } from "../kit/drive";
import { INSPECTOR_W, Workspace } from "../kit/Workspace";
import { baseProject, showProject } from "../setup";

// La planche entière : chaque menu sélectionné allume ses liens, jusqu'au
// bouton qui débite le joueur et lui donne son grade.
const ALL = ["servers", "shop", "ranks", "keys", "cosmetics", "confirm"];
const WALK: [number, string][] = [
  [50, "servers"],
  [85, "shop"],
  [120, "ranks"],
];
const ACCEPT = 160;

export function Links() {
  const { width, height } = useVideoConfig();
  // Le canvas occupe toute la largeur ; l'inspecteur glisse par-dessus à la fin.
  const view = { width, height };
  const start = cameraOn(menuBox(baseProject, "servers"), view, 1.3);
  const board = cameraOn(unionBox(ALL.map((id) => menuBox(baseProject, id))), { width, height: height + 120 }, 0.62);
  const focus = cameraOn(menuBox(baseProject, "confirm"), { width: width - INSPECTOR_W, height }, 1.1);

  useState(() => primeCamera(baseProject.id, start));
  const frame = useDrive((f) => {
    showProject(baseProject);
    hover(null);
    const cam =
      f < ACCEPT - 25
        ? mixCamera(start, board, tween(f, [0, 45], [0, 1]))
        : mixCamera(board, focus, tween(f, [ACCEPT - 25, ACCEPT + 5], [0, 1]));
    setCamera(cam);
    const current = [...WALK].reverse().find(([at]) => f >= at)?.[1];
    // L'inspecteur n'apparaît qu'avec le bouton : le panneau d'un menu entier n'est pas montré.
    if (f >= ACCEPT - 20) select(["accept"], 0, "confirm");
    else select(current ? [current] : []);
  });
  const accept = useMeasure(() => slotCenter("confirm", 10, 3));
  const clicks = [...WALK.map(([at]) => at), ACCEPT - 20];
  const menuAt = useMeasure(() => {
    const out: Record<string, { x: number; y: number }> = {};
    for (const [, id] of WALK) {
      const p = slotCenter(id, 4, 3);
      if (p) out[id] = { x: p.x, y: p.y - 40 };
    }
    return out;
  });
  const rest = { x: width * 0.5, y: height * 0.8 };
  const cursor =
    menuAt && accept
      ? path(frame, [
          [0, rest],
          ...WALK.flatMap(([at, id]): [number, Point][] => [
            [at - 14, menuAt[id] ?? rest],
            [at + 8, menuAt[id] ?? rest],
          ]),
          [ACCEPT - 22, accept],
        ])
      : rest;

  return (
    <AbsoluteFill>
      <Workspace projectId={baseProject.id} library={false} inspector={tween(frame, [ACCEPT - 20, ACCEPT + 4], [0, 1])} />
      <Cursor frame={frame} at={cursor} clicks={clicks} />
      <Caption
        frame={frame}
        start={20}
        end={270}
        title="Every click has a purpose."
        accent="a purpose."
        sub="Open menus, run commands, check ranks and balances."
        position="top-left"
      />
    </AbsoluteFill>
  );
}
