import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useNotify } from "@/hooks/useNotify";
import { idleManager } from "@/lib/idle";
import { loggedInvoke } from "@/lib/utils/utils";
import { devLog } from "@/features/debug-overlay/devLog";
import { useDevStore } from "@/store/devStore";
import { clearUpdateState, simulateUpdateProgress } from "@/store/updateStore";
import { SettingsSection, SettingRow } from "./SettingsShell";

type SqlResult = {
  columns: string[];
  rows: string[][];
} | null;

export function DeveloperToolsSection() {
  const notify = useNotify();
  const [sql, setSql] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<SqlResult>(null);
  const debugOverlayEnabled = useDevStore((state) => state.debugOverlay.enabled);

  const handleDebugOverlayToggle = (checked: boolean) => {
    useDevStore.getState().actions.setDebugOverlay({ enabled: checked });
    devLog("info", "overlay", `debug overlay ${checked ? "enabled" : "disabled"}`);
  };

  const handleExecuteSql = async () => {
    if (!sql.trim()) return;
    setIsExecuting(true);
    setResult(null);
    try {
      const res = await loggedInvoke<{
        success: boolean;
        message: string;
        rows_affected?: number;
        columns?: string[];
        rows?: unknown[][];
      }>("execute_sql", { sql });

      if (res.success) {
        notify.success(res.message);
        if (res.rows_affected !== undefined) {
          setResult({
            columns: [],
            rows: [[`${res.rows_affected} row(s) affected`]],
          });
        } else if (res.columns && res.rows) {
          setResult({
            columns: res.columns,
            rows: res.rows.map((row) => row.map((cell) => String(cell ?? "NULL"))),
          });
        }
      }
    } catch (error) {
      notify.error("SQL error", error as string);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title="Developer tools"
        description="Diagnostics and test controls for development builds."
      >
        <SettingRow
          title="Debug overlay"
          description="Realtime HUD with frontend/backend FPS, CPU, memory, and API call statuses."
          action={
            <Switch
              checked={debugOverlayEnabled}
              onCheckedChange={handleDebugOverlayToggle}
            />
          }
        />
        <SettingRow title="SQL runner" description="Run raw SQL against local app database.">
          <div className="flex flex-col gap-3">
            <Textarea
              value={sql}
              onChange={(event) => setSql(event.target.value)}
              placeholder="SELECT * FROM conversations;"
              rows={6}
            />
            <div className="flex items-start justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleExecuteSql}
                disabled={isExecuting || !sql.trim()}
                startIcon={<Play size={14} />}
              >
                {isExecuting ? "Running..." : "Execute"}
              </Button>
            </div>
            {result ? (
              result.columns.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-border/60">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        {result.columns.map((column) => (
                          <th key={column} className="border-b border-border/60 px-3 py-2 font-medium">
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, rowIndex) => (
                        <tr key={rowIndex} className="border-b border-border/40 last:border-b-0">
                          {row.map((cell, cellIndex) => (
                            <td key={`${rowIndex}-${cellIndex}`} className="px-3 py-2 align-top">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{result.rows[0]?.[0]}</p>
              )
            ) : null}
          </div>
        </SettingRow>

        <SettingRow
          title="Simulated update download"
          action={
            <Button type="button" variant="outline" size="sm" onClick={simulateUpdateProgress}>
              Download
            </Button>
          }
        />
        <SettingRow
          title="Clear update state"
          action={
            <Button type="button" variant="outline" size="sm" onClick={clearUpdateState}>
              Clear
            </Button>
          }
        />
        <SettingRow
          title="Test release notes"
          description="Show release notes modal with confetti for current version."
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                window.dispatchEvent(new CustomEvent("force-release-notes"));
              }}
            >
              Show
            </Button>
          }
        />
        <SettingRow
          title="Idle force active/idle"
          description={`Current: ${import.meta.env.DEV ? idleManager.state : "n/a"}`}
          action={
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => idleManager.forceIdle()}>
                Force Idle
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => idleManager.forceActive()}>
                Force Active
              </Button>
            </div>
          }
        />
        <SettingRow
          title="Unload Whisper model"
          description="Release dictation model from memory."
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await invoke("release_whisper_model");
                  notify.success("Model released");
                } catch {
                  notify.error("No model loaded or unavailable");
                }
              }}
            >
              Release
            </Button>
          }
        />
        <SettingRow
          title="Deactivate dev mode"
          description="Exit developer mode and hide this section."
          action={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => useDevStore.getState().actions.setDevMode(false)}
            >
              Exit Dev Mode
            </Button>
          }
        />
      </SettingsSection>
    </div>
  );
}
