CREATE TABLE IF NOT EXISTS weekly_projection_admin_snapshots (
  snapshot_day date NOT NULL,
  report_key text NOT NULL,
  period_start date NOT NULL,
  cutoff_date date NOT NULL,
  dimension text NOT NULL CHECK (dimension IN ('company', 'store', 'seller')),
  dimension_id text NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_day, report_key, period_start, cutoff_date, dimension, dimension_id)
);

CREATE INDEX IF NOT EXISTS weekly_projection_admin_snapshots_updated_at_idx
  ON weekly_projection_admin_snapshots (updated_at DESC);
