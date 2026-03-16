-- Add email_reports preference to user_settings (1 = enabled, 0 = opted out)
ALTER TABLE user_settings ADD COLUMN email_reports INTEGER NOT NULL DEFAULT 1;
