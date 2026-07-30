import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AcpEvent } from "@/generated/bindings/AcpEvent";
import type { AcpLaunchRequest } from "@/generated/bindings/AcpLaunchRequest";
import type { AcpSessionStart } from "@/generated/bindings/AcpSessionStart";
import type { PermissionDecision } from "@/generated/bindings/PermissionDecision";
import { getCurrentProviderAccountId } from "@/features/providers";
import { getSessionToken } from "@/lib/utils/utils";

const auth = () => ({
  accountId: getCurrentProviderAccountId(),
  token: getSessionToken(),
});

export const acpClient = {
  start(request: AcpLaunchRequest) {
    return invoke<AcpSessionStart>("acp_start_session", {
      request,
      token: getSessionToken(),
    });
  },
  prompt(conversationId: string, prompt: string) {
    return invoke("acp_prompt", { conversationId, prompt, ...auth() });
  },
  cancel(conversationId: string) {
    return invoke<void>("acp_cancel_turn", { conversationId, ...auth() });
  },
  stop(conversationId: string) {
    return invoke<void>("acp_stop_session", { conversationId, ...auth() });
  },
  answer(conversationId: string, requestId: string, decision: PermissionDecision) {
    return invoke<void>("acp_answer_permission", {
      conversationId,
      requestId,
      decision,
      ...auth(),
    });
  },
  events(handler: (event: AcpEvent) => void): Promise<UnlistenFn> {
    return listen<AcpEvent>("acp-session-event", ({ payload }) => handler(payload));
  },
};
