-- The gathering asks a machine to report its numbers with a "probe" command,
-- and the column was never told that kind exists.
--
-- The same trap 005 describes for audit_events: the union in
-- server/lib/types.ts named "probe", the in-memory store accepted it, and every
-- test passed. Against Postgres, "Gather now" failed with
--
--   new row for relation "agent_commands" violates check constraint
--   "agent_commands_kind_check"
--
-- which the player saw as "internal error". The kinds live in two places that
-- have to agree: this constraint and AgentCommand.kind in types.ts.
ALTER TABLE agent_commands DROP CONSTRAINT IF EXISTS agent_commands_kind_check;
ALTER TABLE agent_commands
  ADD CONSTRAINT agent_commands_kind_check
  CHECK (kind IN ('start', 'kill', 'probe'));
