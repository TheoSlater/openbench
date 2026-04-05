import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { User, AuthResponse } from "@/types/auth";

type AuthStore = {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  actions: {
    login: (email: string, password: string) => Promise<void>;
    signup: (email: string, password: string, fullName?: string) => Promise<void>;
    logout: () => Promise<void>;
    updateStatus: (status: string) => Promise<void>;
    restoreSession: () => Promise<void>;
    clearError: () => void;
  };
};

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true, // Initializing as true for auto-login check
  error: null,
  actions: {
    login: async (email, password) => {
      set({ isLoading: true, error: null });
      try {
        const response = await invoke<AuthResponse>("auth_login", { email, password });
        localStorage.setItem("session_token", response.token);
        set({ user: response.user, isAuthenticated: true, isLoading: false });
      } catch (err) {
        set({ error: err as string, isLoading: false });
        throw err;
      }
    },
    signup: async (email, password, fullName) => {
      set({ isLoading: true, error: null });
      try {
        const response = await invoke<AuthResponse>("auth_signup", { email, password, fullName });
        localStorage.setItem("session_token", response.token);
        set({ user: response.user, isAuthenticated: true, isLoading: false });
      } catch (err) {
        set({ error: err as string, isLoading: false });
        throw err;
      }
    },
    logout: async () => {
      set({ isLoading: true });
      try {
        await invoke("auth_logout");
        localStorage.removeItem("session_token");
        set({ user: null, isAuthenticated: false, isLoading: false });
      } catch (err) {
        console.error("Logout error:", err);
        // Still clear local state
        localStorage.removeItem("session_token");
        set({ user: null, isAuthenticated: false, isLoading: false });
      }
    },
    updateStatus: async (status) => {
      const token = localStorage.getItem("session_token");
      if (!token) return;
      try {
        await invoke("auth_update_status", { token, status });
        set((state) => ({
          user: state.user ? { ...state.user, status } : null,
        }));
      } catch (err) {
        set({ error: err as string });
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
        const user = await invoke<User>("auth_get_current_user", { token });
        set({ user, isAuthenticated: true, isLoading: false });
      } catch (err) {
        console.warn("Failed to restore session:", err);
        localStorage.removeItem("session_token");
        set({ user: null, isAuthenticated: false, isLoading: false });
      }
    },
    clearError: () => set({ error: null }),
  },
}));
