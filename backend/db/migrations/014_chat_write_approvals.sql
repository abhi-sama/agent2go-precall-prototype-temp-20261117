-- A write approval is a short-lived, owner-only chat run. The resume chain is auditable and RLS
-- still permits only the initiating user to read either half of the conversation.
ALTER TABLE chat_runs DROP CONSTRAINT IF EXISTS chat_runs_status_check;
ALTER TABLE chat_runs ADD CONSTRAINT chat_runs_status_check
  CHECK (status IN ('running', 'interrupted', 'finished', 'failed'));
ALTER TABLE chat_runs ADD COLUMN resumes_run_id text REFERENCES chat_runs(run_id);
CREATE INDEX chat_runs_resumes_run_idx ON chat_runs(resumes_run_id) WHERE resumes_run_id IS NOT NULL;
