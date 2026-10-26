-- An app's tokens outlive the browser session its user approved it in. The
-- OAuth provider links each access and refresh token to that session and
-- refuses an access token whose session has lapsed, which would end a
-- grant 90 days after its user last opened Sail Scoring in that browser,
-- however often the app refreshed. The provider has no option to stop
-- linking, so the link is never stored: a token without one is checked on
-- its own expiry, revocation and app.
CREATE FUNCTION "oauth_token_unlink_session"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."session_id" := NULL;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "oauth_access_token_unlink_session"
BEFORE INSERT OR UPDATE OF "session_id" ON "oauth_access_token"
FOR EACH ROW EXECUTE FUNCTION "oauth_token_unlink_session"();--> statement-breakpoint
CREATE TRIGGER "oauth_refresh_token_unlink_session"
BEFORE INSERT OR UPDATE OF "session_id" ON "oauth_refresh_token"
FOR EACH ROW EXECUTE FUNCTION "oauth_token_unlink_session"();--> statement-breakpoint
-- Grants made before this keep working through their sessions lapsing too.
UPDATE "oauth_access_token" SET "session_id" = NULL WHERE "session_id" IS NOT NULL;--> statement-breakpoint
UPDATE "oauth_refresh_token" SET "session_id" = NULL WHERE "session_id" IS NOT NULL;
