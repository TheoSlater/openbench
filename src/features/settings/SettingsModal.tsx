import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ADVANCED_SETTINGS_ITEM,
  filterSettingsTabs,
  resolveSettingsTab,
  type SettingsTab,
  type SettingsTabId,
} from "./settingsRegistry";
import {
  SettingsDialog,
  SettingsPanel,
  SettingsSidebar,
} from "./SettingsShell";
import { AboutTab } from "./tabs/AboutTab";
import { AudioTab } from "./tabs/AudioTab";
import { ChatTab } from "./tabs/ChatTab";
import { DataControlsTab } from "./tabs/DataControlsTab";
import { GeneralTab } from "./tabs/GeneralTab";
import { InterfaceTab } from "./tabs/InterfaceTab";
import { MemorySettingsTab } from "./tabs/MemorySettingsTab";
import { MobileTab } from "./tabs/MobileTab";
import { PersonalizationTab } from "./tabs/PersonalizationTab";
import { ProvidersTab } from "./tabs/ProvidersTab";

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
  onOpenAdvancedSettings?: () => void;
  onOpenOnboarding?: () => void;
};

function renderTab(tab: SettingsTabId, onOpenOnboarding?: () => void) {
  switch (tab) {
    case "general":
      return <GeneralTab />;
    case "interface":
      return <InterfaceTab />;
    case "providers":
      return <ProvidersTab />;
    case "mobile":
      return <MobileTab />;
    case "chat":
      return <ChatTab />;
    case "voice":
      return <AudioTab />;
    case "memory":
      return <MemorySettingsTab />;
    case "personalization":
      return <PersonalizationTab onOpenOnboarding={onOpenOnboarding} />;
    case "data-controls":
      return <DataControlsTab />;
    case "about":
      return <AboutTab />;
  }
}

export function SettingsModal({
  isOpen,
  onClose,
  initialTab = "general",
  onOpenAdvancedSettings = () => undefined,
  onOpenOnboarding,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(() => resolveSettingsTab(initialTab));
  const [visitedTabs, setVisitedTabs] = useState<Set<SettingsTabId>>(
    () => new Set([resolveSettingsTab(initialTab)]),
  );
  const [query, setQuery] = useState("");

  const tabs = useMemo(() => filterSettingsTabs(query), [query]);

  const selectTab = useCallback((tab: SettingsTabId) => {
    setActiveTab(tab);
    setVisitedTabs((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const nextTab = resolveSettingsTab(initialTab);
    selectTab(nextTab);
  }, [initialTab, isOpen, selectTab]);

  useEffect(() => {
    if (tabs.some((tab) => tab.id === activeTab)) return;
    selectTab(tabs[0]?.id ?? "general");
  }, [activeTab, selectTab, tabs]);

  const openAdvanced = useCallback(() => {
    onClose();
    onOpenAdvancedSettings();
  }, [onClose, onOpenAdvancedSettings]);

  return (
    <SettingsDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SettingsSidebar
        tabs={tabs}
        activeTab={activeTab}
        query={query}
        advancedItem={ADVANCED_SETTINGS_ITEM}
        onQueryChange={setQuery}
        onSelectTab={selectTab}
        onOpenAdvanced={openAdvanced}
      />
      <SettingsPanel onClose={onClose}>
        {[...visitedTabs].map((tab) => (
          <div key={tab} className={`animate-fade-in ${tab === activeTab ? "block" : "hidden"}`}>
            {renderTab(tab, onOpenOnboarding)}
          </div>
        ))}
      </SettingsPanel>
    </SettingsDialog>
  );
}

export type { SettingsTab } from "./settingsRegistry";
