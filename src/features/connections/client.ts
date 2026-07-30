import { invoke } from "@tauri-apps/api/core";
import type { Connection } from "@/generated/bindings/Connection";
import type { ConnectionModel } from "@/generated/bindings/ConnectionModel";
import type { ConnectionSummary } from "@/generated/bindings/ConnectionSummary";
import type { ConnectionValidation } from "@/generated/bindings/ConnectionValidation";
import type { RuntimeRef } from "@/generated/bindings/RuntimeRef";
import type { Workspace } from "@/generated/bindings/Workspace";
import { getSessionToken } from "@/lib/utils/utils";
import { getCurrentProviderAccountId } from "@/features/providers";

const auth = () => ({ token: getSessionToken() });

export const connectionsClient = {
  list(accountId: string) {
    return invoke<ConnectionSummary[]>("list_connection_summaries", {
      accountId,
      ...auth(),
    });
  },
  models(connectionId: string) {
    return invoke<ConnectionModel[]>("list_connection_models", {
      connectionId,
      ...auth(),
    });
  },
  save(connection: Connection, credential?: string) {
    return invoke<ConnectionValidation>("save_chat_connection", {
      connection,
      credential: credential || null,
      ...auth(),
    });
  },
  validate(connectionId: string) {
    return invoke<ConnectionValidation>("validate_connection", {
      connectionId,
      ...auth(),
    });
  },
  refreshModels(connectionId: string) {
    return invoke<ConnectionModel[]>("refresh_connection_models", {
      connectionId,
      ...auth(),
    });
  },
  saveManualModel(connectionId: string, remoteId: string) {
    return invoke<void>("save_manual_connection_model", {
      connectionId,
      remoteId,
      displayName: null,
      capabilities: null,
      enabled: true,
      aliases: [],
      metadata: null,
      ...auth(),
    });
  },
  setModelEnabled(connectionId: string, remoteId: string, enabled: boolean) {
    return invoke<void>("set_connection_model_enabled", {
      connectionId,
      remoteId,
      enabled,
      ...auth(),
    });
  },
  remove(connectionId: string) {
    return invoke<void>("delete_chat_connection", {
      connectionId,
      ...auth(),
    });
  },
  workspaces(accountId: string) {
    return invoke<Workspace[]>("list_workspaces", { accountId, ...auth() });
  },
  saveWorkspace(workspace: Workspace) {
    return invoke<Workspace>("save_workspace", { workspace, ...auth() });
  },
  recents(accountId: string) {
    return invoke<RuntimeRef[]>("list_recent_runtimes", {
      accountId,
      limit: 8,
      ...auth(),
    });
  },
  setRuntime(conversationId: string, runtime: RuntimeRef) {
    return invoke<void>("set_conversation_runtime", {
      conversationId,
      runtime,
      accountId: getCurrentProviderAccountId(),
      ...auth(),
    });
  },
  getRuntime(conversationId: string) {
    return invoke<RuntimeRef | null>("get_conversation_runtime", {
      conversationId,
      accountId: getCurrentProviderAccountId(),
      ...auth(),
    });
  },
};
