export type CardCondition =
  | "config-invalid"
  | "adapter-missing"
  | "adapter-outdated"
  | "cli-missing"
  | "signed-out"
  | "ready"
  | "disabled"
  | "unvalidated"
  | "failed";

export function cardStatus(condition: CardCondition): string | null {
  switch (condition) {
    case "config-invalid": return "Config error";
    case "adapter-missing": return "Adapter needed";
    case "adapter-outdated": return "Update needed";
    case "cli-missing": return "CLI needed";
    case "signed-out": return "Sign-in needed";
    case "ready": return "Ready";
    case "disabled": return "Enable needed";
    case "unvalidated": return "Validation needed";
    case "failed": return "Fix needed";
  }
}
