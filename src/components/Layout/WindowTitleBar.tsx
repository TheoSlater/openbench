import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/utils/platform";
import {
  TitlebarSidebarButton,
  WindowControls,
} from "@/components/WindowControls";
import { UpdateChip } from "@/components/UpdateChip";
import { PolyUiBrand } from "@/components/PolyUiBrand";
import { TITLE_BAR_HEIGHT } from "@/lib/constants/titlebar";

function WindowTitleBar() {
  if (!IS_MAC && !USE_CUSTOM_WINDOW_CONTROLS) return null;

  return (
    <header
      data-window-titlebar
      data-tauri-drag-region
      className="fixed inset-x-0 top-0 z-[var(--z-titlebar)] flex h-9 min-h-9 shrink-0 select-none items-center rounded-none bg-sidebar"
      style={{
        paddingLeft: IS_MAC ? "var(--macos-titlebar-leading-inset)" : 8,
        paddingRight: IS_MAC ? 8 : 0,
      }}
    >
      <PolyUiBrand />
      <div
        data-tauri-drag-region
        className="flex min-w-0 flex-1 items-center justify-end gap-2"
      >
        <UpdateChip />
      </div>
      {IS_MAC && <TitlebarSidebarButton />}
      {USE_CUSTOM_WINDOW_CONTROLS && <WindowControls />}
    </header>
  );
}

export { TITLE_BAR_HEIGHT, WindowTitleBar };
