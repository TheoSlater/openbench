import { PersonalizationPanel } from "./PersonalizationPanel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

/**
 * Settings modal overlay with personalization controls.
 * @param isOpen - Whether the modal is open.
 * @param onClose - Handler to close the modal.
 */
export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-full max-w-4xl rounded-2xl border border-border/60 bg-card p-6 shadow-[var(--shadow-elev-3)] sm:max-w-4xl md:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure your OpenBench experience.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-6">
          <PersonalizationPanel />
        </div>
      </DialogContent>
    </Dialog>
  );
}
