-- Structure only: do not execute without separate database authorization.
-- One row per dimension member and generation; payload holds its observations.
-- period identifies the commercial month; it does not define its boundaries.
-- cutoff_at is the observation cutoff, not the publication timestamp.
CREATE TABLE IF NOT EXISTS monthly_close_tracking_snapshots (
  environment text NOT NULL CHECK (environment IN ('staging', 'production')),
  period date NOT NULL CHECK (EXTRACT(DAY FROM period) = 1),
  cutoff_date date NOT NULL,
  cutoff_at timestamptz NOT NULL,
  cutoff_timezone text NOT NULL DEFAULT 'America/Santiago'
    CHECK (cutoff_timezone = 'America/Santiago'),
  generation_id uuid NOT NULL,
  dimension text NOT NULL CHECK (dimension IN ('COMPANY', 'DEALERS', 'STORE')),
  dimension_id text NOT NULL CHECK (btrim(dimension_id) <> ''),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  sources jsonb NOT NULL CHECK (jsonb_typeof(sources) = 'object'),
  engine_version text NOT NULL CHECK (btrim(engine_version) <> ''),
  generated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cutoff_date = (cutoff_at AT TIME ZONE 'America/Santiago')::date),
  PRIMARY KEY (
    environment, period, cutoff_date, generation_id, dimension, dimension_id
  )
);

-- The primary-key index supports environment/month/day/generation lookups.
-- No additional index is required for the defined access pattern.
--
-- Future publisher contract (not implemented by this DDL):
-- Validate all expected dimensions/members before inserting the whole generation
-- in one transaction, reusing the atomic-publication pattern of publish().
-- All rows of a generation share period, cutoff, sources and engine version.
-- Supply one generation_id for the batch; do not generate an id per row.
-- Insert new generations without deleting or updating previous cuts.
-- sources records source cutoffs, signatures, evidence ids and source versions.
--
-- Future reader contract (not implemented by this DDL):
-- Select one published generation and read only that generation in one SQL
-- statement, scoped by environment, period and cutoff_date.
-- Atomic visibility requires the publisher transaction; this table alone cannot
-- certify completeness or prevent a caller from committing a partial batch.
