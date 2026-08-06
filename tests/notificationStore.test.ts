import { beforeEach, describe, expect, it } from "vitest";
import { useNotificationStore } from "../src/store/notificationStore";

beforeEach(() => {
  useNotificationStore.setState({ toasts: [] });
});

describe("notification manager", () => {
  it("keeps persistent work visible when transient stack overflows", () => {
    const actions = useNotificationStore.getState().actions;
    const loadingId = actions.add({ type: "loading", message: "Preparing", duration: Infinity });

    for (let index = 0; index < 5; index += 1) {
      actions.add({ type: "success", message: `Done ${index}` });
    }

    const { toasts } = useNotificationStore.getState();
    expect(toasts).toHaveLength(5);
    expect(toasts.some((toast) => toast.id === loadingId)).toBe(true);
    expect(toasts.at(-1)?.duration).toBe(3000);
  });

  it("ignores lifecycle calls for unknown ids", () => {
    const actions = useNotificationStore.getState().actions;

    actions.startRemove("missing");
    actions.update("missing", { message: "Still missing" });
    actions.remove("missing");

    expect(useNotificationStore.getState().toasts).toEqual([]);
  });
});
