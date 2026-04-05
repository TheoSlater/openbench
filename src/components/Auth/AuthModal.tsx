import React, { useState } from "react";
import { createPortal } from "react-dom";
import { Box, Typography, Stack, Button as MuiButton, useTheme, Fade } from "@mui/material";
import { useAuthStore } from "@/store/authStore";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export const AuthModal: React.FC = () => {
  const theme = useTheme();
  const { isAuthenticated, isLoading, error, actions } = useAuthStore();
  console.log("[AuthModal] state:", { isAuthenticated, isLoading, hasError: !!error });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [tab, setTab] = useState<"login" | "signup">("login");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await actions.login(email, password);
    } catch (err) {
      // Error handled by store
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      return;
    }
    try {
      await actions.signup(email, password, fullName || undefined);
    } catch (err) {
      // Error handled by store
    }
  };

  const isOpen = !isAuthenticated && !isLoading;

  if (!isOpen) return null;

  const content = (
    <Fade in={isOpen} timeout={300}>
      <Box
        sx={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "rgba(0, 0, 0, 0.5)",
          zIndex: 1000,
          p: 2,
        }}
      >
        <Box
          sx={{
            position: "relative",
            width: "100%",
            maxWidth: 420,
            maxHeight: "85vh",
            bgcolor: "background.sidebar",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: "12px",
            boxShadow: theme.shadows[24],
            overflow: "hidden",
            zIndex: 1001,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Header */}
          <Box sx={{ p: 3, pb: 2, textAlign: "center", borderBottom: 1, borderColor: "divider" }}>
            <Typography variant="h6" sx={{ fontWeight: 600, color: "text.primary" }}>
              Welcome to OpenBench
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
              Sign in or create an account to continue.
            </Typography>
          </Box>

          {/* Tabs Navigation */}
          <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
            <Stack direction="row" sx={{ width: "100%" }}>
              <MuiButton
                onClick={() => setTab("login")}
                sx={{
                  flex: 1,
                  py: 1.5,
                  borderRadius: 0,
                  color: tab === "login" ? "primary.main" : "text.secondary",
                  borderBottom: 2,
                  borderColor: tab === "login" ? "primary.main" : "transparent",
                  fontWeight: 600,
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                Login
              </MuiButton>
              <MuiButton
                onClick={() => setTab("signup")}
                sx={{
                  flex: 1,
                  py: 1.5,
                  borderRadius: 0,
                  color: tab === "signup" ? "primary.main" : "text.secondary",
                  borderBottom: 2,
                  borderColor: tab === "signup" ? "primary.main" : "transparent",
                  fontWeight: 600,
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                Create Account
              </MuiButton>
            </Stack>
          </Box>

          {/* Content */}
          <Box sx={{ p: 3, overflowY: "auto" }}>
            {tab === "login" && (
              <form onSubmit={handleLogin}>
                <Stack spacing={2.5}>
                  <Stack spacing={1} sx={{ textAlign: "left" }}>
                    <Label htmlFor="email" sx={{ fontSize: "0.875rem", fontWeight: 500, color: "text.primary" }}>Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="name@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      sx={{
                        height: 40,
                        "& .MuiInputBase-input::placeholder": {
                          color: "text.secondary",
                          opacity: 0.5,
                        }
                      }}
                      required
                    />
                  </Stack>
                  <Stack spacing={1} sx={{ textAlign: "left" }}>
                    <Label htmlFor="password" sx={{ fontSize: "0.875rem", fontWeight: 500, color: "text.primary" }}>Password</Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      sx={{ height: 40 }}
                      required
                    />
                  </Stack>
                  {error && (
                    <Typography variant="body2" sx={{ color: "error.main", fontWeight: 500 }}>
                      {error}
                    </Typography>
                  )}
                  <Button type="submit" sx={{ height: 40, fontSize: "1rem" }} disabled={isLoading}>
                    {isLoading ? "Logging in..." : "Login"}
                  </Button>
                  <Box sx={{ textAlign: "center", pt: 1 }}>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                      Don't have an account?{" "}
                      <MuiButton
                        onClick={() => setTab("signup")}
                        sx={{
                          p: 0,
                          minWidth: 0,
                          color: "primary.main",
                          fontWeight: 500,
                          "&:hover": { textDecoration: "underline", backgroundColor: "transparent" }
                        }}
                      >
                        Create one
                      </MuiButton>
                    </Typography>
                  </Box>
                </Stack>
              </form>
            )}

            {tab === "signup" && (
              <form onSubmit={handleSignup}>
                <Stack spacing={2.5}>
                  <Stack spacing={1} sx={{ textAlign: "left" }}>
                    <Label htmlFor="signup-name" sx={{ fontSize: "0.875rem", fontWeight: 500, color: "text.primary" }}>Full Name (Optional)</Label>
                    <Input
                      id="signup-name"
                      placeholder="John Doe"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      sx={{
                        height: 40,
                        "& .MuiInputBase-input::placeholder": {
                          color: "text.secondary",
                          opacity: 0.5,
                        }
                      }}
                    />
                  </Stack>
                  <Stack spacing={1} sx={{ textAlign: "left" }}>
                    <Label htmlFor="signup-email" sx={{ fontSize: "0.875rem", fontWeight: 500, color: "text.primary" }}>Email</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="name@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      sx={{
                        height: 40,
                        "& .MuiInputBase-input::placeholder": {
                          color: "text.secondary",
                          opacity: 0.5,
                        }
                      }}
                      required
                    />
                  </Stack>
                  <Stack spacing={1} sx={{ textAlign: "left" }}>
                    <Label htmlFor="signup-password" sx={{ fontSize: "0.875rem", fontWeight: 500, color: "text.primary" }}>Password</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      sx={{ height: 40 }}
                      required
                    />
                  </Stack>
                  <Stack spacing={1} sx={{ textAlign: "left" }}>
                    <Label htmlFor="confirm-password" sx={{ fontSize: "0.875rem", fontWeight: 500, color: "text.primary" }}>Confirm Password</Label>
                    <Input
                      id="confirm-password"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      sx={{ height: 40 }}
                      required
                    />
                  </Stack>
                  {password !== confirmPassword && confirmPassword !== "" && (
                    <Typography variant="body2" sx={{ color: "error.main", fontWeight: 500 }}>
                      Passwords do not match
                    </Typography>
                  )}
                  {error && (
                    <Typography variant="body2" sx={{ color: "error.main", fontWeight: 500 }}>
                      {error}
                    </Typography>
                  )}
                  <Button type="submit" sx={{ height: 40, fontSize: "1rem" }} disabled={isLoading || (password !== confirmPassword)}>
                    {isLoading ? "Creating account..." : "Create Account"}
                  </Button>
                  <Box sx={{ textAlign: "center", pt: 1 }}>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                      Already have an account?{" "}
                      <MuiButton
                        onClick={() => setTab("login")}
                        sx={{
                          p: 0,
                          minWidth: 0,
                          color: "primary.main",
                          fontWeight: 500,
                          "&:hover": { textDecoration: "underline", backgroundColor: "transparent" }
                        }}
                      >
                        Login
                      </MuiButton>
                    </Typography>
                  </Box>
                </Stack>
              </form>
            )}
          </Box>
        </Box>
      </Box>
    </Fade>
  );

  return createPortal(content, document.body);
};
