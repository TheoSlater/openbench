import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { Minus, PanelLeft, Square, X } from "lucide-react";
import { USE_CUSTOM_WINDOW_CONTROLS, IS_LINUX } from "@/lib/utils/platform";
import { SIDEBAR_TOGGLE_EVENT } from "@/components/ui/sidebar";

export function TitlebarSidebarButton() {
  return (
    <WinButton
      onClick={() => window.dispatchEvent(new Event(SIDEBAR_TOGGLE_EVENT))}
      title="Toggle sidebar"
    >
      <PanelLeft size={16} strokeWidth={1.5} />
    </WinButton>
  );
}

export function WindowControls({ closeOnly = false }: { closeOnly?: boolean }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!USE_CUSTOM_WINDOW_CONTROLS || closeOnly) return;

    const w = getCurrentWindow();
    void w.isMaximized().then(setMaximized);

    const unlisten: Array<() => void> = [];

    void w
      .onResized(() => {
        void w.isMaximized().then(setMaximized);
      })
      .then((fn) => unlisten.push(fn));

    return () => {
      unlisten.forEach((fn) => fn());
    };
  }, [closeOnly]);

  if (!USE_CUSTOM_WINDOW_CONTROLS) return null;

  const w = getCurrentWindow();

  return (
    <div
      className={`flex h-full shrink-0 items-center pr-2 ${
        IS_LINUX ? "gap-1.5" : "gap-0.5"
      }`}
    >
      {!closeOnly && (
        <>
          <TitlebarSidebarButton />
          <div
            aria-hidden="true"
            className="mx-0.5 h-4 w-px bg-sidebar-border/70"
          />
          <WinButton onClick={() => void w.minimize()} title="Minimize">
            <Minus size={16} strokeWidth={1.5} />
          </WinButton>

          <WinButton
            onClick={() => void w.toggleMaximize()}
            title={maximized ? "Restore" : "Maximize"}
          >
            <Square size={14} strokeWidth={1.5} />
          </WinButton>
        </>
      )}

      <WinButton close onClick={() => void w.close()} title="Close">
        <X size={16} strokeWidth={1.5} />
      </WinButton>
    </div>
  );
}

function WinButton({
  children,
  onClick,
  title,
  close = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  close?: boolean;
}) {
  const closeClasses =
    "text-muted-foreground hover:bg-destructive/10 hover:text-destructive " +
    "focus-visible:bg-destructive/10 focus-visible:text-destructive " +
    "active:bg-destructive/20 active:text-destructive";

  const normalClasses =
    "text-muted-foreground hover:bg-accent hover:text-foreground " +
    "focus-visible:bg-accent focus-visible:text-foreground active:bg-accent/80";

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className={
        IS_LINUX
          ? `flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg transition-colors ${
              close ? closeClasses : normalClasses
            }`
          : `flex h-full w-[46px] cursor-pointer items-center justify-center rounded-none transition-colors ${
              close ? closeClasses : normalClasses
            }`
      }
    >
      {children}
    </button>
  );
}
