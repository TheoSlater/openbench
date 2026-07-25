import {
  lazy,
  Suspense,
  useRef,
  useCallback,
  useMemo,
  useState,
  useEffect,
} from "react";
import { useModelStore } from "@/store/modelStore";
import { useSettingsStore } from "@/store/settingsStore";
import "@/features/settings";
import { getPresetContent } from "@/lib/constants/promptPresets";
import { useOllama } from "@/features/ollama";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ChatPanel } from "@/components/Layout/ChatPanel";
import { useChatStore } from "@/store/chatStore";
import { useAuthStore } from "@/store/authStore";
import { useNotify } from "@/hooks/useNotify";
import { useShallow } from "zustand/react/shallow";
import {
  retryTitleForConversation,
  titleStore,
} from "@/lib/chat/title-generation";
import { useFeatures } from "@/lib/featureRegistry";
import { disableMemoryForOwner } from "@/features/memory/memoryClient";
import { getCurrentProviderAccountId } from "@/features/providers";
import { useFolderStore } from "@/store/folderStore";
import type { SettingsTab } from "./features/settings/SettingsModal";
import { ArchivedChatsDialog } from "@/features/chat/components/ArchivedChatsDialog";
import type { CommandPaletteItem } from "@/features/command-palette/types";
import { CommandPalette } from "@/features/command-palette/CommandPalette";
import { useRegisteredCommandPaletteActions } from "@/features/command-palette/actionRegistry";
import { useSettingsCommands } from "@/features/command-palette/settingsRegistry";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useAutoSelectModel } from "@/hooks/useAutoSelectModel";
import { useChatActionHandlers } from "@/hooks/useChatActionHandlers";
import { useCommandPaletteItems } from "@/hooks/useCommandPaletteItems";
import ChatWorkspace from "@/features/chat/components/ChatWorkspace";
import { useViewStore } from "@/lib/view-registry";
import { ADVANCED_SETTINGS_VIEW_ID } from "@/features/settings/settingsRegistry";
import { GlobalConfirmDialog } from "./components/ui/GlobalConfirmDialog";
import { useDevStore } from "@/store/devStore";
import { getDevComponentGalleryAction } from "@/features/dev/componentGalleryAction";
import { useViewportStore } from "@/features/viewport/viewportStore";
import { listen } from "@tauri-apps/api/event";

const AuthModalLazy = lazy(() =>
  import("@/features/auth/AuthModal").then((module) => ({
    default: module.AuthModal,
  })),
);
const ReleaseNotesModalLazy = lazy(() =>
  import("@/features/release-notes/ReleaseNotesModal").then((module) => ({
    default: module.ReleaseNotesModal,
  })),
);
const SettingsModalLazy = lazy(() =>
  import("@/features/settings/SettingsModal").then((module) => ({
    default: module.SettingsModal,
  })),
);
const ViewportDrawerLazy = lazy(() =>
  import("@/features/viewport/ViewportDrawer").then((module) => ({
    default: module.ViewportDrawer,
  })),
);
function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] =
    useState<SettingsTab>("general");
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isArchivedOpen, setIsArchivedOpen] = useState(false);
  const viewportActive = useViewportStore(
    (state) => Boolean(state.session || state.browserOpen),
  );
  const stopStreamingRef = useRef<(() => void) | null>(null);
  const notify = useNotify();
  const {
    selectedModels,
    selectedProviders,
    selectedModelChoices,
    setSelectedModel,
    defaultModel,
  } = useModelStore(
    useShallow((state) => ({
      selectedModels: state.selectedModels,
      selectedProviders: state.selectedProviders,
      selectedModelChoices: state.selectedModelChoices,
      setSelectedModel: state.setSelectedModel,
      defaultModel: state.defaultModel,
    })),
  );

  const ollama = useOllama();
  const { user, isAuthenticated, isAuthLoading, isGuest } = useAuthStore(
    useShallow((state) => ({
      user: state.user,
      isAuthenticated: state.isAuthenticated,
      isAuthLoading: state.isLoading,
      isGuest: state.isGuest,
    })),
  );
  const isAuthGateOpen = !isAuthenticated && !isAuthLoading && !isGuest;

  const handleOpenSettings = useCallback((tab: SettingsTab = "general") => {
    setSettingsInitialTab(tab);
    setIsSettingsOpen(true);
  }, []);
  const handleOpenConnections = useCallback(() => {
    setSettingsInitialTab("connections");
    setIsSettingsOpen(true);
  }, []);
  const handleCloseSettings = useCallback(() => setIsSettingsOpen(false), []);
  const handleOpenAdvancedSettings = useCallback(() => {
    setIsSettingsOpen(false);
    useViewStore.getState().setActiveView(ADVANCED_SETTINGS_VIEW_ID);
  }, []);
  const handleOpenCommandPalette = useCallback(() => {
    if (isAuthGateOpen) return;
    setIsCommandPaletteOpen(true);
  }, [isAuthGateOpen]);
  const handleStopStreamingReady = useCallback(
    (stopStreaming: (() => void) | null) => {
      stopStreamingRef.current = stopStreaming;
    },
    [],
  );

  useKeyboardShortcuts({
    onOpenSettings: handleOpenSettings,
    isAuthGateOpen,
    setIsCommandPaletteOpen,
  });

  useEffect(() => {
    if (isAuthGateOpen) setIsCommandPaletteOpen(false);
  }, [isAuthGateOpen]);

  useAutoSelectModel({
    online: ollama.online,
    models: ollama.models,
    externalModelsLoaded: ollama.externalModelsLoaded,
    externalModelsLoading: ollama.externalModelsLoading,
    loadExternalModels: ollama.actions.loadExternalModels,
    selectedModelsLength: selectedModels.length,
    defaultModel,
    setSelectedModel,
  });

  const { selectedPromptPreset, general } = useSettingsStore(
    useShallow((s) => ({
      selectedPromptPreset: s.selectedPromptPreset,
      general: s.general,
    })),
  );

  const systemPromptContent = useMemo(() => {
    const preset = getPresetContent(selectedPromptPreset);
    return general.systemPrompt ? `${preset}\n${general.systemPrompt}` : preset;
  }, [selectedPromptPreset, general.systemPrompt]);

  useEffect(() => {
    if (import.meta.env.DEV && general.experimentalFeatures) return;
    void disableMemoryForOwner(getCurrentProviderAccountId()).catch(
      () => undefined,
    );
  }, [general.experimentalFeatures]);

  const { conversations, activeConversationId } = useChatStore(
    useShallow((state) => ({
      conversations: state.conversations,
      activeConversationId: state.activeConversationId,
    })),
  );
  const {
    setActiveConversationId,
    deleteConversation,
    deleteAllConversations,
    renameConversation,
  } = useChatStore((state) => state.actions);

  const handleNewChat = useCallback(() => {
    useFolderStore.getState().actions.setActiveFolderId(null);
    setActiveConversationId(null);
  }, [setActiveConversationId]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<{ conversationId?: string }>("mobile-chat-updated", (event) => {
      const changedId = event.payload.conversationId;
      const store = useChatStore.getState();
      void store.actions.loadConversations().then(() => {
        if (changedId && store.activeConversationId === changedId) {
          void store.actions.setActiveConversationId(changedId);
        }
      });
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const handleSelectConversation = useCallback(
    (id: string) => {
      useFolderStore.getState().actions.setActiveFolderId(null);
      const currentId = useChatStore.getState().activeConversationId;
      if (currentId && currentId !== id) {
        retryTitleForConversation(titleStore, currentId);
      }
      setActiveConversationId(id);
    },
    [setActiveConversationId],
  );

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      stopStreamingRef.current?.();
      await deleteConversation(id);
    },
    [deleteConversation],
  );

  const handleRenameConversation = useCallback(
    async (id: string, newTitle: string) => {
      await renameConversation(id, newTitle, "manual");
    },
    [renameConversation],
  );

  const isTemporary = Boolean(
    conversations.find((c) => c.id === activeConversationId)?.isTemporary,
  );
  const activeFolderBackground = useFolderStore(
    (state) =>
      state.folders.find((folder) => folder.id === state.activeFolderId)
        ?.backgroundImage,
  );

  const {
    handleDeleteAllConversations,
    handleRenameCurrentChat,
    handleSetTheme,
  } = useChatActionHandlers({
    stopStreamingRef,
    notify,
    renameConversation,
    deleteAllConversations,
    activeConversationId,
  });

  const features = useFeatures();
  const devMode = useDevStore((state) => state.devMode);
  const registeredActions = useRegisteredCommandPaletteActions();
  const settingsCommands = useSettingsCommands({
    openSettings: handleOpenSettings,
    openAdvancedSettings: handleOpenAdvancedSettings,
  });
  const devComponentGalleryAction = useMemo(
    () => getDevComponentGalleryAction(import.meta.env.DEV, devMode),
    [devMode],
  );

  const handleOpenArchived = useCallback(() => setIsArchivedOpen(true), []);

  const commandPaletteItems = useCommandPaletteItems({
    conversations,
    activeConversationId,
    features,
    onNewChat: handleNewChat,
    onDeleteAllConversations: handleDeleteAllConversations,
    onOpenSettings: handleOpenSettings as (tab?: string) => void,
    onRenameCurrentChat: handleRenameCurrentChat,
    onSetTheme: handleSetTheme,
    onSelectConversation: handleSelectConversation,
    onOpenArchived: handleOpenArchived,
    notify,
    registeredActions: devComponentGalleryAction
      ? [...registeredActions, devComponentGalleryAction]
      : registeredActions,
    settingsCommands,
  });

  return (
    <SidebarProvider className="h-full min-h-0">
      <AppSidebar
        onOpenSettings={handleOpenSettings}
        onOpenCommandPalette={handleOpenCommandPalette}
        onNewChat={handleNewChat}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={handleDeleteConversation}
        onRenameConversation={handleRenameConversation}
        conversations={conversations}
        activeConversationId={activeConversationId}
        collapsible="icon"
      />

      <SidebarInset className="bg-sidebar">
        <ChatPanel backgroundImage={activeFolderBackground}>
          <main className="relative flex min-w-0 flex-1 flex-row overflow-hidden">
            <ChatWorkspace
              selectedModels={selectedModels}
              selectedProviders={selectedProviders}
              selectedModelChoices={selectedModelChoices}
              systemPromptContent={systemPromptContent}
              userName={user?.fullName || user?.email}
              isTemporary={isTemporary}
              onStopStreamingReady={handleStopStreamingReady}
              onOpenConnections={handleOpenConnections}
            />
            {viewportActive && (
              <Suspense fallback={null}>
                <ViewportDrawerLazy />
              </Suspense>
            )}
          </main>
        </ChatPanel>
      </SidebarInset>

      <Suspense fallback={null}>
        {isSettingsOpen ? (
          <SettingsModalLazy
            isOpen={isSettingsOpen}
            onClose={handleCloseSettings}
            initialTab={settingsInitialTab}
            onOpenAdvancedSettings={handleOpenAdvancedSettings}
          />
        ) : null}
      </Suspense>
      <ArchivedChatsDialog
        open={isArchivedOpen}
        onOpenChange={setIsArchivedOpen}
      />
      <CommandPalette
        open={!isAuthGateOpen && isCommandPaletteOpen}
        onOpenChange={setIsCommandPaletteOpen}
        items={commandPaletteItems as CommandPaletteItem[]}
      />
      <GlobalConfirmDialog />
      <Suspense fallback={null}>
        <AuthModalLazy />
      </Suspense>
      <Suspense fallback={null}>
        <ReleaseNotesModalLazy />
      </Suspense>
    </SidebarProvider>
  );
}

export default App;
