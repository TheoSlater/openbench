import { useAuthStore } from "./authStore";
import { useChatStore } from "./chatStore";
import { useFolderStore } from "./folderStore";
import { useDevStore } from "./devStore";
import { useSettingsStore } from "./settingsStore";
import { setTtsSettings, setTtsLoadNotifier, useTtsStore, type TtsLoadProgress } from "./ttsStore";
import { useNotificationStore } from "./notificationStore";
import { setUpdateInstallSimulation } from "./updateStore";
import { getRepository } from "@/lib/repositories";
import { bindViewportOpenRequests, closeViewportForChat } from "@/features/viewport/viewportStore";
import { useProviderStore } from "@/features/providers";

// Cross-store effects live here. Stores own local state only.
let initialized = false;
let lastActiveConversationId: string | undefined;
let authTransitionInProgress = false;
const unsubscribeFns: (() => void)[] = [];

type AuthSnapshot = ReturnType<typeof useAuthStore.getState>;

function accountIdFromAuth(state: AuthSnapshot) {
  return state.user?.id || state.guestId || null;
}

async function refreshProviders() {
  await useProviderStore.getState().actions.refresh().catch((err) => {
    console.warn("[coordinator] Provider refresh failed:", err);
  });
}

// Voice engine (Supertonic) load → one persistent loading toast that tracks
// download progress and only clears when the model is ready or failed.
function makeTtsLoadToast() {
  let toastId: string | null = null;
  const mb = (n: number) => `${Math.max(1, Math.round(n / 1_048_576))} MB`;
  return (progress: TtsLoadProgress) => {
    const toasts = useNotificationStore.getState().actions;
    if (progress.phase === "start") {
      toastId = toasts.add({
        type: "loading",
        message: "Preparing voice engine",
        description: "Loading the local voice model. First use downloads it once.",
        duration: Infinity,
      });
      return;
    }
    if (!toastId) return;
    if (progress.phase === "progress") {
      toasts.update(toastId, {
        description: progress.totalBytes
          ? `Downloading ${progress.file} — ${mb(progress.bytesDownloaded)} / ${mb(progress.totalBytes)}`
          : `Downloading ${progress.file} — ${mb(progress.bytesDownloaded)}`,
      });
    } else if (progress.phase === "done") {
      toasts.update(toastId, {
        type: "success",
        message: "Voice engine ready",
        description: undefined,
        duration: 2500,
      });
      toastId = null;
    } else {
      toasts.update(toastId, {
        type: "error",
        message: "Voice engine failed to load",
        description: progress.message,
        duration: 8000,
      });
      toastId = null;
    }
  };
}

function cleanupDeletedConversation(id: string) {
  closeViewportForChat(id);
}

export function initStoreCoordinator() {
  if (initialized) return;
  initialized = true;

  // Chat model's show_webpage tool → open the viewport on the active chat.
  void bindViewportOpenRequests(() => useChatStore.getState().activeConversationId)
    .then((unlisten) => unsubscribeFns.push(unlisten))
    .catch(() => undefined);

  const initialAuth = useAuthStore.getState();
  const initialAccountId = accountIdFromAuth(initialAuth);
  useChatStore.getState().actions.setAccountId(initialAccountId);
  useFolderStore.getState().actions.setAccountId(initialAccountId);
  setTtsSettings(useSettingsStore.getState().tts);
  setTtsLoadNotifier(makeTtsLoadToast());
  setUpdateInstallSimulation(useDevStore.getState().devMode);

  unsubscribeFns.push(useAuthStore.subscribe((state, prev) => {
    const authId = accountIdFromAuth(state);
    const prevAuthId = accountIdFromAuth(prev);
    const becameReady = authId && !prevAuthId;
    const authIdChanged = authId !== prevAuthId;

    useChatStore.getState().actions.setAccountId(authId);
    useFolderStore.getState().actions.setAccountId(authId);
    if (!authId) {
      useChatStore.setState({
        conversations: [],
        messages: [],
        activeConversationId: null,
        hasMoreMessages: false,
      });
      useFolderStore.setState({ folders: [], activeFolderId: null });
    }

    if (becameReady || authIdChanged) {
      if (authTransitionInProgress) return;
      authTransitionInProgress = true;
      const prevGuestId = prev.guestId;
      const newUserId = state.user?.id;
      void (async () => {
        try {
          if (prevGuestId && newUserId) {
            await getRepository()
              .transferConversations(prevGuestId, newUserId)
              .catch((err) => console.warn("[coordinator] Conversation transfer failed:", err));
          }
          await refreshProviders();
          await useChatStore.getState().actions.loadConversations();
          await useFolderStore.getState().actions.loadFolders();
        } finally {
          authTransitionInProgress = false;
        }
      })();
    }
  }));

  unsubscribeFns.push(useChatStore.subscribe((state, prev) => {
    if (state.deletedConversationIds !== prev.deletedConversationIds) {
      state.deletedConversationIds.forEach((id) => {
        cleanupDeletedConversation(id);
      });
    }

    const currentId = state.activeConversationId;
    if (lastActiveConversationId !== undefined && currentId !== lastActiveConversationId) {
      useTtsStore.getState().actions.stop();
    }
    lastActiveConversationId = currentId ?? undefined;
  }));

  unsubscribeFns.push(useFolderStore.subscribe((state, prev) => {
    if (state.deletedFolderIds === prev.deletedFolderIds || state.deletedFolderIds.length === 0) {
      return;
    }
    useChatStore.getState().actions.clearFolderAssignments(new Set(state.deletedFolderIds));
  }));

  unsubscribeFns.push(useSettingsStore.subscribe((state, prev) => {
    if (state.tts !== prev.tts) {
      setTtsSettings(state.tts);
    }
  }));

  unsubscribeFns.push(useDevStore.subscribe((state, prev) => {
    if (state.devMode !== prev.devMode) {
      setUpdateInstallSimulation(state.devMode);
    }
  }));

  if (initialAccountId) {
    void (async () => {
      await refreshProviders();
      await useChatStore.getState().actions.loadConversations();
      await useFolderStore.getState().actions.loadFolders();
    })();
  }
}

export function cleanupStoreCoordinator() {
  for (const unsub of unsubscribeFns) {
    unsub();
  }
  unsubscribeFns.length = 0;
  initialized = false;
  authTransitionInProgress = false;
  lastActiveConversationId = undefined;
}
