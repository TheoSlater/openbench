import * as React from "react";
import { useNotify } from "@/hooks/useNotify";
import { useDevStore } from "@/store/devStore";

export function PolyUiBrand() {
  const notify = useNotify();
  const setDevMode = useDevStore((s) => s.actions.setDevMode);
  const devTapCount = React.useRef(0);

  const handleDevTap = () => {
    devTapCount.current += 1;
    if (devTapCount.current >= 10) {
      devTapCount.current = 0;
      setDevMode(true);
      notify.success(
        "Dev mode activated",
        "Tap the PolyUI logo 10 more times to deactivate.",
      );
    } else if (devTapCount.current === 1 && useDevStore.getState().devMode) {
      devTapCount.current = 0;
      setDevMode(false);
      notify.info("Dev mode deactivated");
    }
  };

  return (
    <button
      type="button"
      onClick={handleDevTap}
      className="shrink-0 cursor-pointer whitespace-nowrap bg-transparent px-3 text-sm font-medium text-foreground"
    >
      PolyUI
    </button>
  );
}
