import { useEffect, useState } from "react";
import { Reorder } from "motion/react";
import { PanelRightIcon, Plus, SquareTerminal } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settingsStore";
import {
  closeViewport,
  closeViewportTab,
  hideViewportDrawer,
  openViewportTerminal,
  selectViewportTab,
  setViewportTabOrder,
  useViewportStore,
} from "../viewportStore";
import { useDrawerResize } from "../hooks/useDrawerResize";
import { DrawerTab } from "./DrawerTab";
import { TerminalViewport } from "./TerminalViewport";

export function ViewportDrawer() {
  const tabs = useViewportStore((state) => state.tabs);
  const activeTabId = useViewportStore((state) => state.activeTabId);
  const open = useViewportStore((state) => state.drawerOpen);
  const width = useViewportStore((state) => state.drawerWidth);
  const setDrawerWidth = useViewportStore((state) => state.actions.setDrawerWidth);
  const betaFeatures = useSettingsStore((state) => state.general.betaFeatures);
  const reduceMotion = useReducedMotion();
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const { dragging, startResize } = useDrawerResize(width, setDrawerWidth);
  const visible = open && tabs.length > 0;

  // The terminal is the only thing the drawer hosts, and it is beta-gated.
  useEffect(() => {
    if (!betaFeatures && tabs.length) closeViewport();
  }, [betaFeatures, tabs.length]);

  return (
    <aside
      aria-label="Viewport"
      className={cn(
        "relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-border bg-sidebar text-sidebar-foreground",
        !dragging && !reduceMotion && "transition-[width] duration-200 ease-out",
        visible && "border-l border-border",
      )}
      style={{ width: visible ? width : 0, maxWidth: "calc(100% - 320px)" }}
    >
      <div
        className="absolute inset-y-0 left-0 z-20 w-1 cursor-ew-resize touch-none bg-transparent hover:bg-border"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize viewport"
        onPointerDown={startResize}
      />
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-3">
        <nav className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Reorder.Group
            as="div"
            axis="x"
            values={tabs.map((tab) => tab.id)}
            onReorder={setViewportTabOrder}
            className="flex items-center gap-1.5"
          >
            {tabs.map((tab) => (
              <DrawerTab
                key={tab.id}
                id={tab.id}
                icon={<SquareTerminal />}
                label="Terminal"
                active={activeTabId === tab.id}
                dragging={draggedTabId === tab.id}
                reduceMotion={reduceMotion}
                onSelect={() => selectViewportTab(tab.id)}
                onClose={() => closeViewportTab(tab.id)}
                onDragStart={() => setDraggedTabId(tab.id)}
                onDragEnd={() => setDraggedTabId(null)}
              />
            ))}
          </Reorder.Group>
          {betaFeatures ? (
            <IconButton
              size="small"
              className="shrink-0"
              aria-label="New terminal tab"
              title="New terminal"
              onClick={openViewportTerminal}
            >
              <Plus size={16} />
            </IconButton>
          ) : null}
        </nav>
        <IconButton
          size="small"
          aria-label="Hide viewport"
          title="Hide viewport"
          onClick={hideViewportDrawer}
        >
          <PanelRightIcon className="-scale-x-100" size={16} />
        </IconButton>
      </header>
      {tabs.map((tab) => (
        <section
          key={tab.id}
          className={cn(
            "min-h-0 flex-1 bg-sidebar",
            activeTabId === tab.id ? "block" : "hidden",
          )}
        >
          <TerminalViewport />
        </section>
      ))}
    </aside>
  );
}
