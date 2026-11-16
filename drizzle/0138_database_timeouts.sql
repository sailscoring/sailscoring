-- Server-side limits for every session on this database, so a stalled
-- statement or an abandoned transaction ends in a logged error instead of
-- holding a request (and its locks) until the function is killed.
--
-- Set on the database rather than per connection: the app connects through
-- Neon's PgBouncer pooler in transaction mode, which doesn't carry session
-- settings from the client. A database default is applied to every server
-- session the pooler opens. Only new sessions see it.
--
-- The migrate script turns both off for its own session (DDL and backfills
-- can run long), and pg_dump does the same for itself.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET statement_timeout = %L', current_database(), '60s');
  EXECUTE format('ALTER DATABASE %I SET idle_in_transaction_session_timeout = %L', current_database(), '60s');
END
$$;
