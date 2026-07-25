import React, { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { useAuthStore } from "@/store/authStore";

type AuthTab = "login" | "signup";
type SignupStep = 1 | 2;

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor} className="text-xs font-semibold text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function PasswordInput({
  id,
  value,
  showPassword,
  onChange,
  onToggleShowPassword,
}: {
  id: string;
  value: string;
  showPassword: boolean;
  onChange: (value: string) => void;
  onToggleShowPassword: () => void;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        className="h-11 pr-11"
        type={showPassword ? "text" : "password"}
        placeholder="Enter password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onToggleShowPassword}
        aria-label={showPassword ? "Hide password" : "Show password"}
        className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
      >
        {showPassword ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  );
}

function AuthForm({
  tab,
  signupStep,
  onTabChange,
  onSignupStepChange,
}: {
  tab: AuthTab;
  signupStep: SignupStep;
  onTabChange: (tab: AuthTab) => void;
  onSignupStepChange: (step: SignupStep) => void;
}) {
  const isLoading = useAuthStore((state) => state.isLoading);
  const error = useAuthStore((state) => state.error);
  const actions = useAuthStore((state) => state.actions);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const passwordMismatch =
    tab === "signup" && confirmPassword !== "" && password !== confirmPassword;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (tab === "signup" && signupStep === 1) {
      onSignupStepChange(2);
      return;
    }
    if (passwordMismatch) return;

    try {
      if (tab === "login") await actions.login(email, password);
      else await actions.signup(email, password, fullName || undefined);
    } catch {
      // Store owns visible auth error.
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-5">
      {tab === "signup" && signupStep === 1 && (
        <>
          <Field label="Name" htmlFor="signup-name">
            <Input
              id="signup-name"
              className="h-11"
              placeholder="Tessa Rivera"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </Field>
          <Field label="Email" htmlFor="signup-email">
            <Input
              id="signup-email"
              className="h-11"
              type="email"
              placeholder="you@polyui.local"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </Field>
          <Button type="submit" className="h-11" disabled={isLoading} fullWidth>
            Continue
          </Button>
        </>
      )}

      {tab === "signup" && signupStep === 2 && (
        <>
          <Field label="Password" htmlFor="signup-password">
            <PasswordInput
              id="signup-password"
              value={password}
              showPassword={showPassword}
              onChange={setPassword}
              onToggleShowPassword={() => setShowPassword((value) => !value)}
            />
          </Field>
          <Field label="Confirm password" htmlFor="confirm-password">
            <Input
              id="confirm-password"
              className="h-11"
              type={showPassword ? "text" : "password"}
              placeholder="Repeat password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </Field>
          {passwordMismatch && (
            <p className="text-sm font-semibold text-destructive">
              Passwords do not match
            </p>
          )}
          {error && (
            <p className="text-sm font-semibold text-destructive">{error}</p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              className="h-11 w-11"
              onClick={() => onSignupStepChange(1)}
              aria-label="Back to signup details"
            >
              <ArrowLeft />
            </Button>
            <Button type="submit" className="h-11" disabled={isLoading || passwordMismatch} fullWidth>
              {isLoading ? "Working..." : "Create account"}
            </Button>
          </div>
        </>
      )}

      {tab === "login" && (
        <>
          <Field label="Email" htmlFor="login-email">
            <Input
              id="login-email"
              className="h-11"
              type="email"
              placeholder="you@polyui.local"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </Field>
          <Field label="Password" htmlFor="login-password">
            <PasswordInput
              id="login-password"
              value={password}
              showPassword={showPassword}
              onChange={setPassword}
              onToggleShowPassword={() => setShowPassword((value) => !value)}
            />
          </Field>
          {error && (
            <p className="text-sm font-semibold text-destructive">{error}</p>
          )}
          <Button type="submit" className="h-11" disabled={isLoading} fullWidth>
            {isLoading ? "Working..." : "Sign in"}
          </Button>
        </>
      )}

      <p className="text-center text-sm text-muted-foreground">
        {tab === "login" ? "New here?" : "Already have account?"}{" "}
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 align-baseline text-sm font-bold"
          onClick={() => onTabChange(tab === "login" ? "signup" : "login")}
        >
          {tab === "login" ? "Sign up" : "Sign in"}
        </Button>
      </p>
    </form>
  );
}

export const AuthModal: React.FC = () => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);
  const isGuest = useAuthStore((state) => state.isGuest);
  const skipAuth = useAuthStore((state) => state.actions.skipAuth);
  const [tab, setTab] = useState<AuthTab>("login");
  const [signupStep, setSignupStep] = useState<SignupStep>(1);
  const isOpen = !isAuthenticated && !isLoading && !isGuest;

  const handleTabChange = useCallback((nextTab: AuthTab) => {
    setTab(nextTab);
    setSignupStep(1);
  }, []);

  return (
    <Dialog open={isOpen}>
      <DialogContent
        // An auth gate, not a dismissible dialog: the only ways out are
        // signing in or "Continue as guest". Escape and outside clicks were
        // already inert under the old hand-rolled modal, which passed no
        // onClose — this keeps that contract explicit.
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        showCloseButton={false}
        // Offset by the title bar so the panel sits optically centred in the
        // content area rather than the whole window.
        className="top-[calc(50%+(var(--titlebar-height)/2))] gap-8 p-8 sm:max-w-[420px]"
        aria-describedby={undefined}
      >
        <Tabs value={tab} onValueChange={(value) => handleTabChange(value as AuthTab)}>
          <TabsList className="w-full">
            <TabsTrigger value="login" className="flex-1">
              Sign in
            </TabsTrigger>
            <TabsTrigger value="signup" className="flex-1">
              Sign up
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <DialogTitle className="text-center text-2xl font-semibold">
          {tab === "login"
            ? "Welcome back"
            : signupStep === 1
              ? "Create your account"
              : "Secure your account"}
        </DialogTitle>

        <AuthForm
          tab={tab}
          signupStep={signupStep}
          onTabChange={handleTabChange}
          onSignupStepChange={setSignupStep}
        />

        <Button
          type="button"
          variant="link"
          className="mx-auto h-auto p-0 text-sm font-semibold"
          onClick={skipAuth}
        >
          Continue as guest
        </Button>
      </DialogContent>
    </Dialog>
  );
};
