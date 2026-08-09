-- The unit every volume is displayed in: bottles, pumping sessions, totals and
-- charts alike. Entries keep the unit they were logged with. This setting only
-- decides how they are shown, so no two screens can disagree.
ALTER TABLE user_settings
  ADD COLUMN volume_unit TEXT NOT NULL DEFAULT 'ml'
  CHECK(volume_unit IN ('ml', 'oz', 'cc'));
