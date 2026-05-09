-- Report Dashboard: admin review tracking and demand planner reports
-- Run this migration on the production database before deploying the new backend build.

-- Tracks admin/demand planner actions on submitted daily reports
CREATE TABLE IF NOT EXISTS admin_report_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_report_id UUID NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  reviewed_by_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'READ',
  critical_reason TEXT,
  warned_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(daily_report_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_report_reviews_status ON admin_report_reviews(status);
CREATE INDEX IF NOT EXISTS idx_admin_report_reviews_daily_report_id ON admin_report_reviews(daily_report_id);

-- Demand planner authored reports
CREATE TABLE IF NOT EXISTS demand_planner_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  is_critical BOOLEAN NOT NULL DEFAULT FALSE,
  critical_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demand_planner_reports_author_id ON demand_planner_reports(author_id);
CREATE INDEX IF NOT EXISTS idx_demand_planner_reports_is_critical ON demand_planner_reports(is_critical);
