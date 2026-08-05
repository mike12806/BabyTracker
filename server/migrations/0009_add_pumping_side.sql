-- Track which breast a pumping session was for.
-- NULL means the side wasn't recorded (entries logged before this migration).
ALTER TABLE pumping ADD COLUMN side TEXT CHECK(side IN ('left', 'right', 'both'));
