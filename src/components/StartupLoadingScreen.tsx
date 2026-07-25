import { memo, useEffect } from "react";
import { Spinner } from "@/components/ui/spinner";
import { TITLE_BAR_HEIGHT } from "@/lib/constants/titlebar";

type StartupLoadingScreenProps = {
  visible?: boolean;
  onExited?: () => void;
};

function StartupLoadingScreen({
  visible = true,
  onExited,
}: StartupLoadingScreenProps) {
  useEffect(() => {
    if (visible || !onExited) return;
    const timer = setTimeout(onExited, 1000);
    return () => clearTimeout(timer);
  }, [visible, onExited]);

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-[2147483647] flex flex-col items-center justify-center gap-4 bg-background transition-opacity duration-[var(--dur-slow)] ease-[var(--ease-premium)] ${
        visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
      }`}
      style={{ top: TITLE_BAR_HEIGHT }}
    >
      <p className="text-3xl font-bold text-foreground">
        PolyUI
      </p>
      <Spinner className="size-7 text-foreground" />
    </div>
  );
}

export default memo(StartupLoadingScreen);
