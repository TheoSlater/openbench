-- Model switching is free-form: a conversation may move between chat models
-- and coding agents in place. The immutability trigger from the runtime rework
-- (the backstop for the old "fork to switch family" requirement) is removed;
-- `set_conversation_runtime` no longer rejects family changes either, and the
-- header model selector applies a pick directly to the active conversation.

DROP TRIGGER IF EXISTS conversations_runtime_kind_immutable;
