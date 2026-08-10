import { create } from "zustand";
import { getRepository } from "@/lib/repositories";
import { collectDescendantFolderIds } from "@/lib/utils/folders";
import { Folder, Attachment } from "@/types/chat";
import { devLog } from "@/features/debug-overlay/devLog";

async function getRepo() {
  return getRepository();
}

type FolderStore = {
  folders: Folder[];
  foldersLoading: boolean;
  activeFolderId: string | null;
  accountId: string | null;
  deletedFolderIds: string[];
  actions: {
    setAccountId: (accountId: string | null) => void;
    loadFolders: () => Promise<void>;
    createFolder: (name: string, opts?: { parentId?: string; backgroundImage?: string; systemPrompt?: string; contextFiles?: Attachment[] }) => Promise<Folder>;
    updateFolder: (id: string, updates: { name?: string; parentId?: string; backgroundImage?: string; systemPrompt?: string; contextFiles?: Attachment[] }) => Promise<void>;
    deleteFolder: (id: string) => Promise<void>;
    setActiveFolderId: (id: string | null) => void;
  };
};

export const useFolderStore = create<FolderStore>((set) => ({
  folders: [],
  foldersLoading: false,
  activeFolderId: null,
  accountId: null,
  deletedFolderIds: [],
  actions: {
    setAccountId: (accountId) => set({ accountId }),
    loadFolders: async () => {
      set({ foldersLoading: true });
      try {
        const r = await getRepo();
        const userId = useFolderStore.getState().accountId;
        if (!userId) {
          set({ folders: [], activeFolderId: null, foldersLoading: false });
          return;
        }
        const folders = await r.getFolders(userId);
        set({ folders, foldersLoading: false });
      } catch {
        set({ foldersLoading: false });
      }
    },
    createFolder: async (name, opts = {}) => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const folder: Folder = {
        id,
        name,
        parentId: opts.parentId,
        backgroundImage: opts.backgroundImage,
        systemPrompt: opts.systemPrompt,
        contextFiles: opts.contextFiles,
        createdAt: now,
        updatedAt: now,
      };
      set((state) => ({
        folders: [...state.folders, folder],
      }));
      try {
        const r = await getRepo();
        const userId = useFolderStore.getState().accountId || undefined;
        await r.createFolder(id, name, userId, opts.parentId);
        if (opts.backgroundImage || opts.systemPrompt || opts.contextFiles) {
          await r.updateFolder(id, {
            backgroundImage: opts.backgroundImage ?? null,
            systemPrompt: opts.systemPrompt ?? null,
            contextFiles: opts.contextFiles ? JSON.stringify(opts.contextFiles) : null,
            updatedAt: now,
          });
        }
      } catch (error) {
        devLog("error", "folder-store", "Failed to persist folder", error);
        set((state) => ({
          folders: state.folders.filter((candidate) => candidate.id !== id),
        }));
        throw error;
      }
      return folder;
    },
    updateFolder: async (id, updates) => {
      const now = new Date().toISOString();
      const previous = useFolderStore.getState().folders;
      set((state) => ({
        folders: state.folders.map((f) =>
          f.id === id
            ? { ...f, ...updates, updatedAt: now }
            : f,
        ),
      }));
      try {
        const r = await getRepo();
        await r.updateFolder(id, {
          name: updates.name,
          parentId: updates.parentId,
          backgroundImage: updates.backgroundImage !== undefined ? (updates.backgroundImage ?? null) : undefined,
          systemPrompt: updates.systemPrompt !== undefined ? (updates.systemPrompt ?? null) : undefined,
          contextFiles: updates.contextFiles !== undefined ? JSON.stringify(updates.contextFiles) : undefined,
          updatedAt: now,
        });
      } catch (error) {
        devLog("error", "folder-store", "Failed to update folder", error);
        set({ folders: previous });
        throw error;
      }
    },
    deleteFolder: async (id) => {
      const state = useFolderStore.getState();
      const previousFolders = state.folders;
      const previousActiveFolderId = state.activeFolderId;
      const descendantIds = collectDescendantFolderIds(state.folders, id);
      set((state) => ({
        folders: state.folders.filter((f) => !descendantIds.has(f.id)),
        activeFolderId: state.activeFolderId && descendantIds.has(state.activeFolderId) ? null : state.activeFolderId,
      }));
      try {
        const r = await getRepo();
        await r.clearConversationFolders([...descendantIds]);
        await Promise.all([...descendantIds].map((folderId) => r.deleteFolder(folderId)));
        set({ deletedFolderIds: [...descendantIds] });
      } catch (error) {
        devLog("error", "folder-store", "Failed to delete folder", error);
        set({ folders: previousFolders, activeFolderId: previousActiveFolderId });
        throw error;
      }
    },
    setActiveFolderId: (id) => set({ activeFolderId: id }),
  },
}));
