import { useEffect, useRef, useState } from "react";
import { usePauseableHandler } from "@/lib/idle/hooks";
import { useSettingsStore } from "@/store/settingsStore";

/** How long a hidden viewport keeps its page alive before being torn down. */
const OFFLOAD_TIMEOUT_MS = 120_000;

/**
 * Frees what a hidden viewport is holding. Suspending stops rendering it;
 * after {@link OFFLOAD_TIMEOUT_MS} the page is dropped entirely, so coming
 * back has to reload. Disabled by the "keep viewport active" setting.
 *
 * `onWake` runs when a suspended viewport becomes visible again.
 */
export function useViewportSuspension({
  visible,
  hasContent,
  onWake,
}: {
  visible: boolean;
  hasContent: boolean;
  onWake: () => void;
}): { suspended: boolean; offloaded: boolean } {
  const keepViewportActive = useSettingsStore((state) => state.performance.keepViewportActive);
  const [suspended, setSuspended] = useState(false);
  const [offloaded, setOffloaded] = useState(false);
  const offloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Kept in a ref so a caller's inline callback does not re-run the effect and
  // restart the offload timer on every render.
  const onWakeRef = useRef(onWake);
  onWakeRef.current = onWake;

  const wake = () => {
    if (offloadTimerRef.current) {
      clearTimeout(offloadTimerRef.current);
      offloadTimerRef.current = null;
    }
    setSuspended(false);
    setOffloaded(false);
    onWakeRef.current();
  };

  useEffect(() => {
    if (keepViewportActive) return;
    if (!visible && hasContent) {
      setSuspended(true);
      setOffloaded(false);
      offloadTimerRef.current = setTimeout(() => setOffloaded(true), OFFLOAD_TIMEOUT_MS);
    } else if (visible && (suspended || offloaded)) {
      wake();
    }
    return () => {
      if (offloadTimerRef.current) {
        clearTimeout(offloadTimerRef.current);
        offloadTimerRef.current = null;
      }
    };
    // Intentionally not reacting to suspended/offloaded: they are outputs of
    // this effect, and re-running on them would restart the offload timer.
  }, [visible, keepViewportActive]);

  usePauseableHandler("viewport-drawer", {
    onPause: () => {
      if (keepViewportActive) return;
      if (!visible && !suspended && hasContent) setSuspended(true);
    },
    onResume: () => {
      if (keepViewportActive) return;
      if (visible && (suspended || offloaded)) wake();
    },
    priority: 100,
  });

  return { suspended, offloaded };
}
