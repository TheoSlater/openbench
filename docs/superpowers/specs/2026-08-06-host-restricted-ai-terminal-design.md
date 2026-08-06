# Host-restricted AI terminal

## Goal

Run the AI terminal without Docker or Podman while keeping the lowest practical
CPU and memory overhead. Only commands that pass a deterministic, explicit
host-safety policy may run. Everything else fails closed with a useful reason.

“Host” means the machine running Poly UI with the same permissions as the app.
The terminal must never elevate to administrator/root and must not silently
fall back to a general host shell.

## Non-goals

- No arbitrary shell execution on the host.
- No project, home-directory, credential, or system-root access.
- No LLM-based safety decision.
- No OS-specific container replacement in this change.
- No hard CPU or memory isolation claim; the allowlist reduces process scope and
  runtime overhead, but it is not equivalent to a kernel-enforced resource
  sandbox.

## Architecture

`SandboxManager` remains the Tauri boundary used by the AI PTY, but it manages
only app-owned ephemeral host workspaces.

- Delete the Docker/Podman runtime discovery, image bootstrap, container
  sessions, container port forwarding, container capability installation, and
  container orphan cleanup.
- Keep one headless session per AI sandbox id. Its root contains only virtual
  `/workspace`, `/home/sandbox`, and `/tmp` directories.
- Reuse the existing PTY and `SandboxCommand` seam. A safe command returns an
  absolute host executable, translated arguments, an allowed cwd, and a fixed
  environment. An unsafe command returns a policy error before a PTY starts.
- Keep session cleanup, idle reaping, workspace accounting, stop/reset actions,
  and `sandbox-destroyed` events for the ephemeral host workspace.
- Host commands run as the current Poly UI user. No elevation, `sudo`, `su`,
  `doas`, `runas`, or administrator token is introduced.

The PTY skips all container-only port polling and container process handling.
Reset removes the app-owned temporary workspace. The terminal diagnostics
report `host-restricted`, no container name, no ports, and no container CPU or
memory limits.

## Command-safety algorithm

The classifier is deterministic and runs before executable resolution:

1. Reject empty commands, control characters, shell operators, quoting,
   command substitution, globbing, chaining, redirection, and more than 16
   tokens or 2,000 input characters.
2. Parse with the existing token parser; never pass the original command to a
   shell.
3. Match the first token against the fixed read-only program table:
   `pwd`, `true`, `false`, `echo`, `printf`, `node --version`, `python3
   --version`, `git --version`, `git status`, `git status --short`, `ls`,
   `cat`, `head`, `tail`, `wc`, `grep`, and `rg`.
4. Validate each program’s arguments with an explicit grammar. Options are
   allowlisted per program; paths may only refer to the three virtual workspace
   roots and may not contain parent traversal. Search and file commands cannot
   receive arbitrary flags or executable paths.
5. Resolve the executable to an absolute file from trusted system/tool
   directories. Do not execute a program found through an arbitrary current
   directory or an untrusted command string.
6. Resolve existing path targets canonically and require them to remain inside
   the session workspace. This closes symlink escapes as well as lexical `..`
   escapes.
7. Build a host plan with `env_clear()` and only fixed values such as `HOME`,
   `PATH`, `TERM`, locale, and the virtual workspace paths. Never inherit API
   keys, shell startup files, or the user’s ambient environment.
8. If any rule fails, return `Command blocked: <reason>` and do not attempt a
   Docker, Podman, shell, or alternate executable fallback.

The policy stays intentionally read-only: it does not permit shell interpreters,
package managers, compilers, network clients, file mutators, process launchers,
or server processes. This is the lowest-overhead option that remains a useful
inspection terminal.

## Data flow

1. The AI emits a terminal command part.
2. The frontend invokes `pty_spawn_command` with the command and sandbox id.
3. `SandboxManager::spawn_command` validates the id, creates or reuses the
   ephemeral workspace, classifies the command, and returns a host plan or a
   policy error.
4. `pty.rs` starts the approved absolute executable directly in the PTY with
   the fixed cwd/environment, relays output, and reports exit status.
5. Stop closes the PTY; reset destroys the session workspace; idle cleanup
   removes inactive workspaces.
6. The AI receives output or the explicit blocked-command error.

## UI and diagnostics

Keep the existing terminal controls and lifecycle. Replace container-specific
copy with host-restricted wording:

- Runtime: `Host restricted`
- Container: `None`
- Ports: none
- Capabilities: `read-only`
- CPU/memory limits: not reported as enforced limits

The UI must not imply that a Docker/Podman container or kernel resource limit
exists.

## Verification

Add or update Rust tests for:

- every allowed command shape and its translated host plan;
- shell syntax, unknown programs, unsafe flags, absolute/out-of-root paths,
  parent traversal, symlink escapes, and command-length/token limits;
- empty inherited environment and fixed workspace mapping;
- no Docker/Podman runtime discovery or container command construction;
- host session cleanup, idle reaping, stop/reset behavior, and diagnostics.

Run the focused sandbox tests, PTY tests, frontend tests covering terminal error
display, formatting, typecheck, and the production build. Manually verify that
an allowed command runs without Docker/Podman installed and that a rejected
command never starts a process.

## Scope boundary

Project or home-directory access is intentionally excluded. Supporting edits or
project inspection would require a separate, explicit workspace permission and
an OS-native isolation design; it must not be added by widening this allowlist.
