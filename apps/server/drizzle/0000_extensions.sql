-- Custom migration (drizzle-kit cannot express extensions). Must run before any table uses citext.
-- citext is a "trusted" extension, so the database owner may create it without being a superuser.
CREATE EXTENSION IF NOT EXISTS citext;
