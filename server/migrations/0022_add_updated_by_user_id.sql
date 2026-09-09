-- Add user attribution (who last edited the entry) to all activity tables.
-- NULL means the entry has never been edited since creation, or was edited
-- before this migration.
ALTER TABLE feedings ADD COLUMN updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE diaper_changes ADD COLUMN updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sleep ADD COLUMN updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tummy_time ADD COLUMN updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE pumping ADD COLUMN updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE growth ADD COLUMN updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE temperature ADD COLUMN updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE notes ADD COLUMN updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE medications ADD COLUMN updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
