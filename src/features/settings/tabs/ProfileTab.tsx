import { useEffect, useRef, useState } from "react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Box } from "@/components/ui/Box";
import { Button } from "@/components/ui/button";
import { ButtonBase } from "@/components/ui/button-base";
import { Stack } from "@/components/ui/Stack";
import { TextField } from "@/components/ui/text-field";
import { Typography } from "@/components/ui/Typography";
import { Camera, Lock, Save } from "lucide-react";
import { EmptyState, SectionHeader, SettingCard } from "../SettingComponents";
import { useNotify } from "@/hooks/useNotify";
import { imageUploadConfig } from "@/lib/image-upload/config";
import { validateImageFiles } from "@/lib/image-upload/validation";
import { useAuthStore } from "@/store/authStore";
import { useShallow } from "zustand/react/shallow";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const IMAGE_ACCEPT = imageUploadConfig.allowedMimeTypes.join(",");
const PASSWORD_HELP = "Use 8 to 128 characters.";

const isValidEmail = (value: string) =>
  value.length > 3 &&
  value.length <= 254 &&
  value.includes("@") &&
  !value.startsWith("@") &&
  !value.endsWith("@") &&
  !/\s/.test(value);

const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Image could not be read."));
    reader.onerror = () => reject(new Error("Image could not be read."));
    reader.readAsDataURL(file);
  });

const initialsFor = (name: string, email: string) => (name.trim() || email.trim() || "U")[0].toUpperCase();

type AvatarPickerProps = {
  value: string;
  label: string;
  fallback: string;
  seed: string;
  onChange: (dataUrl: string, fileName: string) => void;
};

function AvatarPicker({ value, label, fallback, seed, onChange }: AvatarPickerProps) {
  const notify = useNotify();
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const validation = validateImageFiles([file], { maxFiles: 1, maxFileSize: MAX_AVATAR_BYTES });
    if (validation.errors[0]) return notify.error("Profile picture rejected", validation.errors[0].message);
    try {
      onChange(await readDataUrl(file), file.name);
    } catch (err) {
      notify.error("Profile picture failed", String(err));
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" accept={IMAGE_ACCEPT} onChange={pick} style={{ display: "none" }} />
      <ButtonBase
        aria-label="Upload profile picture"
        onClick={() => inputRef.current?.click()}
        className="group relative box-border size-14 rounded-full border-0 p-0"
      >
        <Avatar className="size-14">
          <AvatarImage src={value || undefined} alt={label} />
          <AvatarFallback seed={seed}>{fallback}</AvatarFallback>
        </Avatar>
        <Box
          className="pointer-events-none absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          <Camera size={18} />
        </Box>
      </ButtonBase>
    </>
  );
}

export function ProfileTab() {
  const { notify, success, error, dismiss } = useNotify();
  const notifiedRef = useRef(false);
  const toastIdRef = useRef("");
  const { user, isGuest, isLoading, actions } = useAuthStore(
    useShallow((state) => ({
      user: state.user,
      isGuest: state.isGuest,
      isLoading: state.isLoading,
      actions: state.actions,
    })),
  );
  const [displayName, setDisplayName] = useState(user?.fullName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [avatar, setAvatar] = useState(user?.avatarUrl ?? "");
  const [avatarFileName, setAvatarFileName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);

  const normalizedEmail = email.trim().toLowerCase();
  const profileDirty =
    displayName.trim() !== (user?.fullName ?? "") ||
    normalizedEmail !== (user?.email ?? "").toLowerCase() ||
    avatar !== (user?.avatarUrl ?? "");
  const passwordDirty = Boolean(currentPassword || newPassword || confirmPassword);
  const passwordInvalid =
    Boolean(newPassword) && (newPassword.length < 8 || newPassword.length > 128);
  const passwordMismatch = Boolean(confirmPassword) && newPassword !== confirmPassword;
  const emailInvalid = !isValidEmail(normalizedEmail);

  useEffect(() => {
    setDisplayName(user?.fullName ?? "");
    setEmail(user?.email ?? "");
    setAvatar(user?.avatarUrl ?? "");
    setAvatarFileName("");
  }, [user?.avatarUrl, user?.email, user?.fullName]);

  useEffect(() => {
    const dirty = profileDirty || passwordDirty;
    if (dirty && !notifiedRef.current) {
      notifiedRef.current = true;
      toastIdRef.current = notify("Unsaved profile changes", "warning", { duration: Infinity }) ?? "";
    }
    if (!dirty) {
      notifiedRef.current = false;
      if (toastIdRef.current) {
        dismiss(toastIdRef.current);
        toastIdRef.current = "";
      }
    }
  }, [passwordDirty, profileDirty, notify, dismiss]);

  useEffect(() => () => {
    if (toastIdRef.current) dismiss(toastIdRef.current);
  }, [dismiss]);

  if (!user || isGuest) return <EmptyState>Profile settings are available after sign in.</EmptyState>;

  const saveProfile = async () => {
    if (emailInvalid || !profileDirty) return;
    setProfileSaving(true);
    try {
      await actions.updateProfile({ email: normalizedEmail, fullName: displayName.trim() || undefined, avatarUrl: avatar || undefined });
      success("Profile updated");
    } catch (err) {
      error("Profile update failed", String(err));
    } finally {
      setProfileSaving(false);
    }
  };

  const savePassword = async () => {
    if (passwordInvalid || passwordMismatch || !currentPassword || !newPassword) return;
    setPasswordSaving(true);
    try {
      await actions.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      success("Password changed");
    } catch (err) {
      error("Password change failed", String(err));
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h6">Profile</Typography>
        <Typography>
          Manage local account details, profile picture, and password.
        </Typography>
      </Box>

      <Stack spacing={1.5}>
        <SectionHeader title="Identity" description="These details stay in the local app database." />
        <SettingCard title="Account details">
          <Stack spacing={2}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ xs: "flex-start", sm: "center" }}>
              <AvatarPicker
                value={avatar}
                label={displayName || email}
                fallback={initialsFor(displayName, email)}
                seed={displayName.trim() || email.trim()}
                onChange={(dataUrl, fileName) => {
                  setAvatar(dataUrl);
                  setAvatarFileName(fileName);
                }}
              />
              <Stack spacing={1.5}>
                <TextField label="Display name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} fullWidth size="small" slotProps={{ htmlInput: { maxLength: 120 } }} />
                <TextField label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} error={emailInvalid} helperText={emailInvalid ? "Enter a valid email address." : " "} fullWidth required size="small" slotProps={{ htmlInput: { maxLength: 254 } }} />
              </Stack>
            </Stack>

            <Stack spacing={1} alignItems="flex-start">
              <Typography>
                {avatarFileName ? `Selected ${avatarFileName}` : "Click avatar to choose a local image."}
              </Typography>
              <Button size="sm" startIcon={<Save size={14} />} onClick={saveProfile} disabled={isLoading || profileSaving || emailInvalid || !profileDirty}>
                {profileSaving ? "Saving..." : "Save"}
              </Button>
            </Stack>
          </Stack>
        </SettingCard>
      </Stack>

      <Stack spacing={1.5}>
        <SectionHeader title="Security" description="Change your password with current-password verification." />
        <SettingCard title="Password" description="Changing password keeps this session active and expires other sessions.">
          <Stack spacing={1.5}>
            <TextField label="Current password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} fullWidth size="small" autoComplete="current-password" />
            <TextField label="New password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} error={passwordInvalid} helperText={passwordInvalid ? PASSWORD_HELP : " "} fullWidth size="small" autoComplete="new-password" slotProps={{ htmlInput: { maxLength: 128 } }} />
            <TextField label="Confirm new password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} error={passwordMismatch} helperText={passwordMismatch ? "Passwords do not match." : " "} fullWidth size="small" autoComplete="new-password" slotProps={{ htmlInput: { maxLength: 128 } }} />
            <Box>
              <Button size="sm" variant="outline" startIcon={<Lock size={14} />} onClick={savePassword} disabled={isLoading || passwordSaving || passwordInvalid || passwordMismatch || !currentPassword || !newPassword || !confirmPassword}>
                {passwordSaving ? "Updating..." : "Update password"}
              </Button>
            </Box>
          </Stack>
        </SettingCard>
      </Stack>
    </Stack>
  );
}
