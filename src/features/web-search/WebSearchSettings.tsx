import { useRef, useState } from "react";
import { Link } from "@/components/ui/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Stack } from "@/components/ui/Stack";
import { Typography } from "@/components/ui/Typography";
import { SettingCard, selectClassName } from "@/features/settings/SettingComponents";
import { useSettingsStore } from "@/store/settingsStore";
import { useNotify } from "@/hooks/useNotify";
import { webSearchProviderRegistry } from "./registry";
import type { WebSearchProviderId } from "./types";
import { useWebSearchConfig, useWebSearchCredential } from "./useWebSearchConfig";

export function WebSearchSettings() {
  const updateGeneral = useSettingsStore((state) => state.actions.updateGeneral);
  const { provider, webSearch } = useWebSearchConfig();
  const { configured, save } = useWebSearchCredential(provider.id);
  const credentialRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const notify = useNotify();

  const saveCredential = async () => {
    setSaving(true);
    try {
      await save(credentialRef.current?.value ?? "");
      if (credentialRef.current) credentialRef.current.value = "";
      notify.success("Web search credential saved");
    } catch (error) {
      notify.error("Could not save credential", String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={0}>
      <SettingCard
        title="Web search provider"
        description="Choose provider used for live web results."
        action={
          <Select
            value={provider.id}
            onValueChange={(value) => {
              updateGeneral({
                webSearch: {
                  ...webSearch,
                  provider: value as WebSearchProviderId,
                },
              });
            }}
          >
            <SelectTrigger size="sm" className={selectClassName}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {webSearchProviderRegistry.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        }
      />

      {provider.requiresApiKey ? (
        <SettingCard
          title={`${provider.name} API key`}
          description="Stored locally on this device. Sent only to selected search provider."
        >
          <Stack spacing={0.75}>
            <Input
              ref={credentialRef}
              placeholder={configured ? "Saved in system keychain" : provider.apiKeyPlaceholder}
              type="password"
              autoComplete="off"
            />
            <Button size="sm" onClick={() => void saveCredential()} disabled={saving}>
              {saving ? "Saving…" : "Save key"}
            </Button>
            <Typography>
              Need key?{" "}
              <Link href={provider.dashboardUrl} target="_blank" rel="noreferrer">
                Open {provider.name} dashboard
              </Link>
            </Typography>
          </Stack>
        </SettingCard>
      ) : (
        <SettingCard
          title="Local search"
          description="Uses local DuckDuckGo search. No API key required."
        />
      )}
    </Stack>
  );
}
