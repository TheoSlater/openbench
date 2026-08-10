import { create } from "zustand";
import { User, AuthResponse } from "@/types/auth";
import { loggedInvoke } from "@/lib/utils/utils";
import { devLog } from "@/features/debug-overlay/devLog";

const GUEST_ID_KEY = "polyui.guestId";

function loadGuestId(): string | null {
  try {
    return localStorage.getItem(GUEST_ID_KEY);
  } catch { return null; }
}

function saveGuestId(id: string | null) {
  try {
    if (id) localStorage.setItem(GUEST_ID_KEY, id);
    else localStorage.removeItem(GUEST_ID_KEY);
  } catch {}
}

type AuthStore = {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  isGuest: boolean;
  guestId: string | null;
  actions: {
    login: (email: string, password: string) => Promise<void>;
    signup: (email: string, password: string, fullName?: string) => Promise<void>;
    logout: () => Promise<void>;
    updateStatus: (status: string) => Promise<void>;
    updateProfile: (input: { email: string; fullName?: string; avatarUrl?: string }) => Promise<void>;
    changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
    restoreSession: () => Promise<void>;
    clearError: () => void;
    skipAuth: () => void;
    openAuth: () => void;
  };
};

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  isGuest: false,
  guestId: loadGuestId(),

  actions: {
    skipAuth: () => {
      const id = get().guestId || crypto.randomUUID();
      saveGuestId(id);
      set({ isGuest: true, guestId: id, isLoading: false });
    },

    login: async (email, password) => {
      set({ isLoading: true, error: null });
      try {
        const response = await loggedInvoke<AuthResponse>("auth_login", { email, password });
        localStorage.setItem("session_token", response.token);

        saveGuestId(null);
        set({ user: response.user, isAuthenticated: true, isGuest: false, guestId: null, isLoading: false });
      } catch (err) {
        set({ error: err as string, isLoading: false });
        throw err;
      }
    },
    signup: async (email, password, fullName) => {
      set({ isLoading: true, error: null });
      try {
        const response = await loggedInvoke<AuthResponse>("auth_signup", { email, password, fullName });
        localStorage.setItem("session_token", response.token);

        saveGuestId(null);
        set({ user: response.user, isAuthenticated: true, isGuest: false, guestId: null, isLoading: false });
      } catch (err) {
        set({ error: err as string, isLoading: false });
        throw err;
      }
    },
    logout: async () => {
      set({ isLoading: true });
      try {
        const token = localStorage.getItem("session_token");
        if (token) {
          await loggedInvoke("auth_logout", { token });
        }
        localStorage.removeItem("session_token");
        set({ user: null, isAuthenticated: false, isLoading: false });
      } catch (err) {
        devLog("error", "auth", "Logout failed", err);
        localStorage.removeItem("session_token");
        set({ user: null, isAuthenticated: false, isLoading: false });
      }
    },
    updateStatus: async (status) => {
      const token = localStorage.getItem("session_token");
      if (!token) return;
      try {
        await loggedInvoke("auth_update_status", { token, status });
        set((state) => ({
          user: state.user ? { ...state.user, status } : null,
        }));
      } catch (err) {
        set({ error: err as string });
      }
    },
    updateProfile: async ({ email, fullName, avatarUrl }) => {
      const token = localStorage.getItem("session_token");
      if (!token) throw new Error("Session expired");
      set({ isLoading: true, error: null });
      try {
        const user = await loggedInvoke<User>("auth_update_profile", {
          token,
          email,
          fullName,
          avatarUrl,
        });
        set({ user, isLoading: false });
      } catch (err) {
        set({ error: err as string, isLoading: false });
        throw err;
      }
    },
    changePassword: async (currentPassword, newPassword) => {
      const token = localStorage.getItem("session_token");
      if (!token) throw new Error("Session expired");
      set({ isLoading: true, error: null });
      try {
        await loggedInvoke("auth_change_password", { token, currentPassword, newPassword });
        set({ isLoading: false });
      } catch (err) {
        set({ error: err as string, isLoading: false });
        throw err;
      }
    },
    restoreSession: async () => {
      const token = localStorage.getItem("session_token");
      if (!token) {
        set({ isLoading: false });
        return;
      }
      set({ isLoading: true });
      try {
        const user = await loggedInvoke<User>("auth_get_current_user", { token });
        set({ user, isAuthenticated: true, isLoading: false });
      } catch {
        localStorage.removeItem("session_token");
        set({ user: null, isAuthenticated: false, isLoading: false });
      }
    },
    openAuth: () => {
      set({ isGuest: false, error: null });
    },
    clearError: () => set({ error: null }),
  },
}));
