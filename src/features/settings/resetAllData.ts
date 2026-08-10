import { invoke } from "@/lib/tauriBridge";

export async function resetAllData(): Promise<void> {
  await invoke("reset_local_data");
  localStorage.clear();
  sessionStorage.clear();
  window.location.reload();
}
