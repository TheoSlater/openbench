import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { useThemeStore } from "./store/themeStore";
import { useSettingsStore } from "./store/settingsStore";
import { NotificationProvider } from "./components/ui/Toast/NotificationProvider";
import { TooltipProvider } from "./components/ui/tooltip";
import StartupLoadingScreen from "./components/StartupLoadingScreen";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { WindowTitleBar } from "./components/Layout/WindowTitleBar";
import { WindowResizeBorders } from "./components/WindowResizeBorders";
import { prepareAppStartup } from "./startup";
import {
  startupError as reportStartupError,
  installFrontendDiagnostics,
  startupPhase,
} from "./lib/utils/startupDiagnostics";
import { USE_CUSTOM_WINDOW_CONTROLS } from "./lib/utils/platform";
import { devLog } from "@/features/debug-overlay/devLog";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useShallow } from "zustand/react/shallow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@/lib/tauriBridge";
import { TITLE_BAR_HEIGHT } from "@/lib/constants/titlebar";
import "./App.css";
import App from "./App";

installFrontendDiagnostics();

document.documentElement.style.setProperty(
  "--titlebar-height",
  `${TITLE_BAR_HEIGHT}px`,
);
if (USE_CUSTOM_WINDOW_CONTROLS) {
  document.documentElement.setAttribute("data-chrome", "borderless");
} else {
  document.documentElement.removeAttribute("data-chrome");
}

function Root() {
  const { mode, previewMode } = useThemeStore(useShallow((state) => ({
    mode: state.mode,
    previewMode: state.previewMode,
  })));
  const performance = useSettingsStore((state) => state.performance);
  const prefersDarkMode = usePrefersDarkMode();
  const [isAppReady, setIsAppReady] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [showStartupScreen, setShowStartupScreen] = useState(true);
  const [isStartupScreenVisible, setIsStartupScreenVisible] = useState(true);

  useEffect(() => {
    let cancelled = false;

    startupPhase("prepareAppStartup begin");
    prepareAppStartup()
      .then(() => {
        startupPhase("prepareAppStartup complete");
        invoke("startup_frontend_loaded").catch((e) =>
          devLog("error", "startup", "Frontend log command failed", e),
        );
        if (!cancelled) setIsAppReady(true);
      })
      .catch((error) => {
        reportStartupError("App startup failed", error);
        if (!cancelled) setStartupError(formatStartupError(error));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isAppReady || startupError) {
      setIsStartupScreenVisible(false);
    }
  }, [isAppReady, startupError]);

  useEffect(() => {
    if (!isAppReady && !startupError) return;
    const show = () => {
      startupPhase("window show requested");
      getCurrentWindow()
        .show()
        .catch((e) => reportStartupError("window.show failed", e));
    };
    const t1 = setTimeout(show, 50);
    const t2 = setTimeout(show, 500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isAppReady, startupError]);

  useEffect(() => {
    const effectiveMode = previewMode ?? mode;
    const isDark = effectiveMode === "dark" || (effectiveMode === "system" && prefersDarkMode);
    document.documentElement.classList.toggle("dark", isDark);
  }, [mode, prefersDarkMode, previewMode]);

  // OS preference seeds this setting once; user choice controls it afterward.
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", reduceMotion);
    document.documentElement.classList.toggle(
      "reduce-transparency",
      performance.reduceTransparency,
    );
  }, [reduceMotion, performance.reduceTransparency]);

  useEffect(() => {
    const appZoom = Math.min(2, Math.max(0.5, performance.appZoom || 1));
    let innerFrame = 0;
    const frame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        document.documentElement.style.setProperty(
          "--app-zoom",
          String(appZoom),
        );
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(innerFrame);
    };
  }, [performance.appZoom]);
  useEffect(() => {
    if (!USE_CUSTOM_WINDOW_CONTROLS || !isAppReady) return;
    const w = getCurrentWindow();
    const sync = () => {
      void w.isMaximized().then((m) => {
        document.documentElement.classList.toggle("maximized", m);
      });
    };
    sync();
    const unlisten: (() => void)[] = [];
    void w.onResized(sync).then((fn) => unlisten.push(fn));
    return () => {
      unlisten.forEach((fn) => fn());
    };
  }, [isAppReady]);

  useEffect(() => {
    if (!DEV) return;
    const id = setInterval(() => {
      window.performance.clearMeasures();
      window.performance.clearMarks();
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    void document.fonts?.load("1em JetBrains Mono");
  }, []);

  return (
    <TooltipProvider>
      <NotificationProvider>
        <ErrorBoundary>
          <div className="app-root-shell">
            <WindowResizeBorders />
            <WindowTitleBar />
            {startupError ? (
              <StartupErrorScreen message={startupError} />
            ) : isAppReady ? (
              <div className="app-content relative zoom-content animate-fade-in">
                <App />
              </div>
            ) : null}
          </div>
          {showStartupScreen && (
            <StartupLoadingScreen
              visible={isStartupScreenVisible}
              onExited={() => setShowStartupScreen(false)}
            />
          )}
        </ErrorBoundary>
      </NotificationProvider>
    </TooltipProvider>
  );
}

startupPhase("react root render begin");
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  DEV ? (
    <React.StrictMode>
      <Root />
    </React.StrictMode>
  ) : (
    <Root />
  ),
);
startupPhase("react root render requested");

function formatStartupError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function usePrefersDarkMode() {
  const [prefersDark, setPrefersDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;

    const update = () => setPrefersDark(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return prefersDark;
}

function StartupErrorScreen({ message }: { message: string }) {
  const [logPath, setLogPath] = useState<string | null>(null);

  useEffect(() => {
    invoke<string | null>("startup_log_path")
      .then((path) => setLogPath(path))
      .catch(() => setLogPath(null));
  }, []);

  return (
    <div className="startup-error-screen">
      <div className="startup-error-panel">
        <h1 className="startup-error-title">Poly UI could not start</h1>
        <p className="startup-error-message">{message}</p>
        {logPath ? <p className="startup-error-log">Log: {logPath}</p> : null}
        <button
          onClick={() => window.location.reload()}
          className="startup-error-button"
        >
          Restart
        </button>
      </div>
    </div>
  );
}
