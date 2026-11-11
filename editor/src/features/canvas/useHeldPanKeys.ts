import { isTypingTarget } from "@/lib/keyboard";
import { useEffect, useState } from "react";

/**
 * Space or Alt held = temporary pan, so you can navigate without leaving select
 * mode. Alt during a *node* drag still means "free move / no snap"
 * (useNodeAlignment) — different target, no conflict. Released on window blur.
 */
export function useHeldPanKeys(): { spaceHeld: boolean; altHeld: boolean } {
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [altHeld, setAltHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === "Space" && !isTypingTarget(e.target)) {
        e.preventDefault();
        setSpaceHeld(true);
      }
      if (e.key === "Alt" && !isTypingTarget(e.target)) {
        e.preventDefault();
        setAltHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
      if (e.key === "Alt") setAltHeld(false);
    };
    const onBlur = () => {
      setSpaceHeld(false);
      setAltHeld(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  return { spaceHeld, altHeld };
}
