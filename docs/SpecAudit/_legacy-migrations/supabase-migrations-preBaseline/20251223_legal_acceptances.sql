-- Legal Acceptances Table for Clickwrap Auditability
-- Tracks when users accept legal documents for compliance

CREATE TABLE IF NOT EXISTS legal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_key text NOT NULL,
  doc_version text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('student', 'parent')),
  minor boolean NOT NULL DEFAULT false,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  ip_address text,
  
  CONSTRAINT unique_acceptance UNIQUE (user_id, doc_key, doc_version, actor_type)
);

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user_id ON legal_acceptances(user_id);
CREATE INDEX IF NOT EXISTS idx_legal_acceptances_doc_key ON legal_acceptances(doc_key);

ALTER TABLE legal_acceptances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own acceptances"
  ON legal_acceptances
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own acceptances"
  ON legal_acceptances
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE legal_acceptances IS 'Audit log of legal document acceptances for compliance and clickwrap tracking';
COMMENT ON COLUMN legal_acceptances.doc_key IS 'Identifier for the legal document (privacy_policy, student_terms, etc)';
COMMENT ON COLUMN legal_acceptances.doc_version IS 'Version of the document accepted (typically the last_updated date)';
COMMENT ON COLUMN legal_acceptances.actor_type IS 'Who accepted: student or parent';
COMMENT ON COLUMN legal_acceptances.minor IS 'Whether the student is under 18';
