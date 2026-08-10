import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Stack } from "@/components/ui/Stack";
import { Typography } from "@/components/ui/Typography";
import { Camera, ImagePlus, RotateCcw, Save, Trash2 } from "lucide-react";
import { SettingCard } from "../SettingComponents";
import { SettingsSection } from "../SettingsShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useNotify } from "@/hooks/useNotify";
import { useAuthStore } from "@/store/authStore";
import { useSettingsStore } from "@/store/settingsStore";
import { resetAllData } from "../resetAllData";
import {
  normalizeDisplayName,
  profileInitials,
  profileLabel,
  PROFILE_NAME_MAX,
  readProfileImage,
} from "@/features/onboarding/profile";

export function ProfileTab({ onOpenOnboarding }: { onOpenOnboarding?: () => void }) {
  const { success, error: notifyError } = useNotify();
  const { user } = useAuthStore(useShallow((state) => ({ user: state.user })));
  const { profile, profileConfigured, actions } = useSettingsStore(
    useShallow((state) => ({
      profile: state.profile,
      profileConfigured: state.profileConfigured,
      actions: state.actions,
    })),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    setDisplayName(profileConfigured ? profile.displayName : user?.fullName ?? "");
    setAvatarUrl(profileConfigured ? profile.avatarUrl : user?.avatarUrl ?? null);
    setAvatarError("");
  }, [profile, profileConfigured, user?.avatarUrl, user?.fullName]);

  const fallbackName = profileConfigured ? displayName : displayName || user?.fullName || "You";
  const initialName = profileConfigured ? profile.displayName : user?.fullName ?? "";
  const initialAvatar = profileConfigured ? profile.avatarUrl : user?.avatarUrl ?? null;
  const dirty = normalizeDisplayName(displayName) !== normalizeDisplayName(initialName)
    || avatarUrl !== initialAvatar;

  const chooseImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      setAvatarError("");
      setAvatarUrl(await readProfileImage(file));
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "Image could not be used.");
    }
  };

  const save = () => {
    if (normalizeDisplayName(displayName).length > PROFILE_NAME_MAX) return;
    setSaving(true);
    try {
      actions.setProfile({
        displayName: normalizeDisplayName(displayName),
        avatarUrl,
      });
      success("Local profile saved");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setResetting(true);
    try {
      await resetAllData();
    } catch (error) {
      setResetting(false);
      notifyError("Could not reset PolyUI data", String(error));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title="Local profile"
        description="Choose how you appear in conversations. Stored on this device."
        action={
          onOpenOnboarding ? (
            <Button size="sm" variant="outline" onClick={onOpenOnboarding}>
              <RotateCcw data-icon="inline-start" />
              Review onboarding
            </Button>
          ) : undefined
        }
      >
        <SettingCard title="Identity" description="No account or online username is needed.">
          <Stack spacing={3}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                aria-label="Choose profile image"
                onClick={() => inputRef.current?.click()}
                className="group relative size-16 shrink-0 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
              >
                <Avatar className="size-16">
                  {avatarUrl ? <AvatarImage src={avatarUrl} alt={profileLabel(fallbackName)} /> : null}
                  <AvatarFallback seed={fallbackName}>{profileInitials(fallbackName)}</AvatarFallback>
                </Avatar>
                <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  <Camera className="size-5" />
                </span>
              </button>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Label htmlFor="local-display-name">Display name</Label>
                <Input
                  id="local-display-name"
                  value={displayName}
                  maxLength={PROFILE_NAME_MAX}
                  placeholder="You"
                  onChange={(event) => setDisplayName(event.target.value)}
                />
                <Typography variant="caption" color="secondary">
                  Leave it empty to appear as You.
                </Typography>
              </div>
            </div>

            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
              className="hidden"
              onChange={(event) => {
                void chooseImage(event.target.files?.[0]);
                event.target.value = "";
              }}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
                <ImagePlus data-icon="inline-start" />
                Choose image
              </Button>
              {avatarUrl ? (
                <Button size="sm" variant="ghost" onClick={() => setAvatarUrl(null)}>
                  <Trash2 data-icon="inline-start" />
                  Remove image
                </Button>
              ) : null}
              <Button size="sm" onClick={save} disabled={!dirty || saving || Boolean(avatarError)}>
                <Save data-icon="inline-start" />
                {saving ? "Saving…" : "Save profile"}
              </Button>
            </div>
            {avatarError ? <p className="text-sm text-destructive" role="alert">{avatarError}</p> : null}
          </Stack>
        </SettingCard>
        <SettingCard
          title="Reset all data"
          description="Permanently remove chats, folders, memories, provider connections, saved credentials, and local settings. PolyUI will reopen onboarding."
          action={
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setResetOpen(true)}
              disabled={resetting}
            >
              <Trash2 data-icon="inline-start" />
              {resetting ? "Resetting…" : "Reset all data"}
            </Button>
          }
        />
      </SettingsSection>
      <ConfirmDialog
        open={resetOpen}
        onOpenChange={(open) => { if (!resetting) setResetOpen(open); }}
        title="Reset all PolyUI data?"
        description="This permanently deletes all local chats, folders, memories, provider connections, saved credentials, settings, and onboarding progress. Installed CLIs and files outside PolyUI are not removed."
        confirmLabel="Reset all data"
        onConfirm={() => void reset()}
        destructive
      />
    </div>
  );
}
