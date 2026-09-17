-- ---------------------------------------------------------------------------
-- Legal consent records the slug, version and content hash of what was served.
-- LYCEON-MIGRATION-REVIEWED
--
-- @spec [LYCEON legal versioning Phase 2 §3; Cal. Bus. & Prof. Code § 17602(a)(4)]
-- @implemented 2026-09-15
--
-- plain English: a consent row records WHICH document, WHICH version, and the
-- SHA-256 of the exact text that was served. "Prove what this person agreed to"
-- then becomes: read content_hash, find the version directory whose meta.yml
-- carries it, hash en.md, compare. Reproducible by anyone, years later, without
-- trusting that a version label still points at the same words.
--
-- Before this, doc_version held a date ("2024-12-22") that came from a file
-- separate from the text, and the text itself lived in a TypeScript module with
-- no version field at all. Nothing connected what a person read to what was
-- recorded against them.
--
-- BOTH COLUMNS ARE NULLABLE, DELIBERATELY. Two reasons, neither of them laziness:
--   1. The 24 existing rows (12 users, 2026-06-19 .. 2026-09-15) record
--      acceptance of December-2024 text that exists nowhere in the repository.
--      They are NOT backfilled: stamping them with a v2.0 hash would assert
--      those users accepted text they never saw, which is manufacturing
--      evidence rather than retaining it. NULL says "we did not retain this",
--      which is the truth. Owner ruling, 2026-09-15.
--   2. During a rollout an older instance can still enqueue an outbox payload
--      without these fields. The drain accepts it and writes NULL rather than
--      discarding the consent as an invalid payload.
--
-- Rows written from here on always carry both.
--
-- NOT APPLIED BY THIS CHANGE. Authored here; the owner applies it. The Supabase
-- connector is read-only in this program and never runs DDL against production.
--
-- ROLLBACK: the DOWN block at the foot drops the index, the CHECK constraint and
-- both columns. It is additive-only in reverse — no data written by the previous
-- schema is touched, because no existing column is altered or dropped by UP.
-- ---------------------------------------------------------------------------

-- ============================================================================
-- UP

ALTER TABLE public.legal_acceptances
  ADD COLUMN IF NOT EXISTS doc_slug     text,
  ADD COLUMN IF NOT EXISTS content_hash text;

COMMENT ON COLUMN public.legal_acceptances.doc_slug IS
  'legal/<slug> the consent is for. NULL only on rows predating Phase 2.';

COMMENT ON COLUMN public.legal_acceptances.content_hash IS
  'sha256:<64 hex> of the exact en.md served at acceptance, copied from that version''s meta.yml. NULL only on rows predating Phase 2, whose text was never retained. Never backfilled — a guessed hash is a false record.';

-- Shape guard: if a hash is present it must be a well-formed sha256. A
-- malformed hash is worse than none, because it looks verifiable and is not.
ALTER TABLE public.legal_acceptances
  DROP CONSTRAINT IF EXISTS legal_acceptances_content_hash_shape;

ALTER TABLE public.legal_acceptances
  ADD CONSTRAINT legal_acceptances_content_hash_shape
  CHECK (content_hash IS NULL OR content_hash ~ '^sha256:[0-9a-f]{64}$');

-- "Which users accepted the text with this hash" is the audit question, so it
-- gets the index. Partial: the NULL rows are not answerable and not worth space.
CREATE INDEX IF NOT EXISTS idx_legal_acceptances_content_hash
  ON public.legal_acceptances (content_hash)
  WHERE content_hash IS NOT NULL;

-- The uniqueness rule is unchanged: (user_id, doc_key, doc_version, actor_type).
-- doc_version now holds "2.0" rather than a date, so an acceptance of v2.0 and a
-- later acceptance of v3.0 remain distinct rows, which is what the ARL
-- retention requirement needs.

-- ============================================================================
-- DOWN (reversible)
--
-- DROP INDEX IF EXISTS public.idx_legal_acceptances_content_hash;
-- ALTER TABLE public.legal_acceptances
--   DROP CONSTRAINT IF EXISTS legal_acceptances_content_hash_shape;
-- ALTER TABLE public.legal_acceptances
--   DROP COLUMN IF EXISTS content_hash,
--   DROP COLUMN IF EXISTS doc_slug;
