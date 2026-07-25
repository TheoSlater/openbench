import { useEffect, useState } from "react";
import { useSettingsStore } from "@/store/settingsStore";

const QUERY = "(prefers-reduced-motion: reduce)";

function osPrefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.(QUERY).matches === true;
}

/**
 * The in-app setting OR the OS preference. Reading only the setting meant a
 * user with reduce-motion enabled system-wide still got every animation.
 */
export function useReducedMotion(): boolean {
  const setting = useSettingsStore((s) => s.performance.reduceMotion);
  const [os, setOs] = useState(osPrefersReducedMotion);

  useEffect(() => {
    const media = window.matchMedia?.(QUERY);
    if (!media) return;
    const onChange = () => setOs(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return setting || os;
}
