-- Seed data for local development
-- Run with: npx wrangler d1 execute baby-tracker-db --local --file=seed/seed.sql

-- Create test users
INSERT OR IGNORE INTO users (email, name) VALUES ('dev@example.com', 'Dev User');
INSERT OR IGNORE INTO users (email, name) VALUES ('parent2@example.com', 'Co-Parent');

-- Create children
INSERT OR IGNORE INTO children (id, first_name, last_name, birth_date)
VALUES (1, 'Emma', 'Johnson', '2024-06-15');
INSERT OR IGNORE INTO children (id, first_name, last_name, birth_date)
VALUES (2, 'Liam', 'Johnson', '2025-01-10');

-- Link users to children
INSERT OR IGNORE INTO user_children (user_id, child_id)
SELECT u.id, 1 FROM users u WHERE u.email = 'dev@example.com';
INSERT OR IGNORE INTO user_children (user_id, child_id)
SELECT u.id, 2 FROM users u WHERE u.email = 'dev@example.com';
INSERT OR IGNORE INTO user_children (user_id, child_id)
SELECT u.id, 1 FROM users u WHERE u.email = 'parent2@example.com';
INSERT OR IGNORE INTO user_children (user_id, child_id)
SELECT u.id, 2 FROM users u WHERE u.email = 'parent2@example.com';

-- ===== Emma's data (born 2024-06-15, ~9 months old) =====

-- Feedings (last few days)
INSERT INTO feedings (child_id, type, start_time, end_time, amount, amount_unit, notes) VALUES
  (1, 'bottle', '2025-03-13T06:30:00Z', '2025-03-13T06:50:00Z', 6, 'oz', 'Morning bottle'),
  (1, 'solid', '2025-03-13T08:00:00Z', '2025-03-13T08:30:00Z', NULL, NULL, 'Oatmeal and banana'),
  (1, 'bottle', '2025-03-13T11:00:00Z', '2025-03-13T11:20:00Z', 5, 'oz', NULL),
  (1, 'solid', '2025-03-13T12:30:00Z', '2025-03-13T13:00:00Z', NULL, NULL, 'Sweet potato and peas'),
  (1, 'bottle', '2025-03-13T15:00:00Z', '2025-03-13T15:15:00Z', 4, 'oz', 'Afternoon bottle'),
  (1, 'solid', '2025-03-13T17:30:00Z', '2025-03-13T18:00:00Z', NULL, NULL, 'Chicken and rice'),
  (1, 'bottle', '2025-03-13T19:30:00Z', '2025-03-13T19:45:00Z', 6, 'oz', 'Bedtime bottle'),
  (1, 'bottle', '2025-03-12T06:15:00Z', '2025-03-12T06:35:00Z', 6, 'oz', NULL),
  (1, 'solid', '2025-03-12T08:00:00Z', '2025-03-12T08:25:00Z', NULL, NULL, 'Yogurt and berries'),
  (1, 'bottle', '2025-03-12T11:30:00Z', '2025-03-12T11:50:00Z', 5, 'oz', NULL),
  (1, 'solid', '2025-03-12T12:30:00Z', '2025-03-12T13:00:00Z', NULL, NULL, 'Avocado toast'),
  (1, 'bottle', '2025-03-12T15:30:00Z', '2025-03-12T15:45:00Z', 4, 'oz', NULL),
  (1, 'bottle', '2025-03-12T19:30:00Z', '2025-03-12T19:50:00Z', 6, 'oz', 'Bedtime bottle');

-- Diaper changes
INSERT INTO diaper_changes (child_id, time, type, color, notes) VALUES
  (1, '2025-03-13T06:00:00Z', 'wet', NULL, 'Morning diaper'),
  (1, '2025-03-13T09:00:00Z', 'both', 'brown', NULL),
  (1, '2025-03-13T11:30:00Z', 'wet', NULL, NULL),
  (1, '2025-03-13T14:00:00Z', 'solid', 'brown', NULL),
  (1, '2025-03-13T16:30:00Z', 'wet', NULL, NULL),
  (1, '2025-03-13T19:00:00Z', 'wet', NULL, 'Before bed'),
  (1, '2025-03-12T06:30:00Z', 'wet', NULL, NULL),
  (1, '2025-03-12T09:30:00Z', 'both', 'brown', NULL),
  (1, '2025-03-12T12:00:00Z', 'wet', NULL, NULL),
  (1, '2025-03-12T15:00:00Z', 'wet', NULL, NULL),
  (1, '2025-03-12T18:30:00Z', 'solid', 'yellow', NULL);

-- Sleep entries
INSERT INTO sleep (child_id, start_time, end_time, is_nap, notes) VALUES
  (1, '2025-03-13T09:30:00Z', '2025-03-13T10:45:00Z', 1, 'Morning nap'),
  (1, '2025-03-13T13:30:00Z', '2025-03-13T15:00:00Z', 1, 'Afternoon nap'),
  (1, '2025-03-13T19:45:00Z', '2025-03-14T06:00:00Z', 0, 'Night sleep'),
  (1, '2025-03-12T09:00:00Z', '2025-03-12T10:30:00Z', 1, 'Morning nap'),
  (1, '2025-03-12T13:00:00Z', '2025-03-12T14:45:00Z', 1, 'Afternoon nap'),
  (1, '2025-03-12T20:00:00Z', '2025-03-13T06:00:00Z', 0, 'Night sleep');

-- Tummy time
INSERT INTO tummy_time (child_id, start_time, end_time, milestone, notes) VALUES
  (1, '2025-03-13T07:00:00Z', '2025-03-13T07:15:00Z', 'Reaching for toys', NULL),
  (1, '2025-03-13T11:00:00Z', '2025-03-13T11:10:00Z', NULL, 'Short session before feeding'),
  (1, '2025-03-13T16:00:00Z', '2025-03-13T16:20:00Z', 'Pivoting on belly', 'Great session!'),
  (1, '2025-03-12T07:30:00Z', '2025-03-12T07:45:00Z', NULL, NULL),
  (1, '2025-03-12T16:30:00Z', '2025-03-12T16:50:00Z', 'Army crawl attempt', 'Almost crawling!');

-- Growth measurements
INSERT INTO growth (child_id, date, weight, weight_unit, height, height_unit, head_circumference, head_circumference_unit, notes) VALUES
  (1, '2024-06-15', 7.5, 'lb', 19.5, 'in', 13.5, 'in', 'Birth measurements'),
  (1, '2024-07-15', 9.2, 'lb', 21.0, 'in', 14.5, 'in', '1 month checkup'),
  (1, '2024-08-15', 11.0, 'lb', 22.5, 'in', 15.2, 'in', '2 month checkup'),
  (1, '2024-10-15', 14.5, 'lb', 24.5, 'in', 16.5, 'in', '4 month checkup'),
  (1, '2024-12-15', 17.0, 'lb', 26.0, 'in', 17.0, 'in', '6 month checkup'),
  (1, '2025-03-10', 19.5, 'lb', 28.0, 'in', 17.8, 'in', '9 month checkup');

-- Temperature readings
INSERT INTO temperature (child_id, time, reading, reading_unit, notes) VALUES
  (1, '2025-03-13T06:00:00Z', 98.6, 'F', 'Normal morning temp'),
  (1, '2025-03-10T14:00:00Z', 99.8, 'F', 'Slightly elevated after vaccination'),
  (1, '2025-03-10T20:00:00Z', 100.2, 'F', 'Low-grade fever, gave Tylenol'),
  (1, '2025-03-11T08:00:00Z', 98.8, 'F', 'Back to normal');

-- Notes
INSERT INTO notes (child_id, time, title, content) VALUES
  (1, '2025-03-13T12:00:00Z', 'New food', 'Tried peas for the first time - she loved them!'),
  (1, '2025-03-10T15:00:00Z', '9 month checkup', 'All looks good. Doctor happy with growth. Next vaccines at 12 months.'),
  (1, '2025-03-08T10:00:00Z', 'Milestone', 'Emma pulled herself up to standing using the coffee table!');

-- ===== Liam's data (born 2025-01-10, ~2 months old) =====

-- Feedings (mostly breastfeeding at this age)
INSERT INTO feedings (child_id, type, start_time, end_time, amount, amount_unit, notes) VALUES
  (2, 'breast_left', '2025-03-13T06:00:00Z', '2025-03-13T06:20:00Z', NULL, NULL, NULL),
  (2, 'breast_right', '2025-03-13T08:30:00Z', '2025-03-13T08:50:00Z', NULL, NULL, NULL),
  (2, 'breast_left', '2025-03-13T11:00:00Z', '2025-03-13T11:25:00Z', NULL, NULL, 'Good latch'),
  (2, 'bottle', '2025-03-13T13:30:00Z', '2025-03-13T13:45:00Z', 3, 'oz', 'Pumped milk'),
  (2, 'breast_right', '2025-03-13T16:00:00Z', '2025-03-13T16:20:00Z', NULL, NULL, NULL),
  (2, 'breast_left', '2025-03-13T18:30:00Z', '2025-03-13T18:55:00Z', NULL, NULL, NULL),
  (2, 'breast_right', '2025-03-13T21:00:00Z', '2025-03-13T21:15:00Z', NULL, NULL, 'Cluster feeding'),
  (2, 'breast_left', '2025-03-13T23:00:00Z', '2025-03-13T23:20:00Z', NULL, NULL, NULL),
  (2, 'breast_right', '2025-03-14T02:00:00Z', '2025-03-14T02:15:00Z', NULL, NULL, 'Night feed');

-- Diaper changes
INSERT INTO diaper_changes (child_id, time, type, color, notes) VALUES
  (2, '2025-03-13T06:30:00Z', 'wet', NULL, NULL),
  (2, '2025-03-13T09:00:00Z', 'both', 'yellow', 'Seedy'),
  (2, '2025-03-13T11:30:00Z', 'wet', NULL, NULL),
  (2, '2025-03-13T14:00:00Z', 'both', 'yellow', NULL),
  (2, '2025-03-13T16:30:00Z', 'wet', NULL, NULL),
  (2, '2025-03-13T19:00:00Z', 'wet', NULL, NULL),
  (2, '2025-03-13T21:30:00Z', 'both', 'yellow', NULL),
  (2, '2025-03-14T02:30:00Z', 'wet', NULL, 'Night change');

-- Sleep (newborn pattern)
INSERT INTO sleep (child_id, start_time, end_time, is_nap, notes) VALUES
  (2, '2025-03-13T07:00:00Z', '2025-03-13T08:30:00Z', 1, NULL),
  (2, '2025-03-13T09:30:00Z', '2025-03-13T11:00:00Z', 1, NULL),
  (2, '2025-03-13T12:00:00Z', '2025-03-13T13:30:00Z', 1, 'Long nap'),
  (2, '2025-03-13T14:30:00Z', '2025-03-13T16:00:00Z', 1, NULL),
  (2, '2025-03-13T17:00:00Z', '2025-03-13T18:30:00Z', 1, NULL),
  (2, '2025-03-13T19:30:00Z', '2025-03-13T21:00:00Z', 0, 'First stretch'),
  (2, '2025-03-13T21:30:00Z', '2025-03-14T02:00:00Z', 0, 'Longest stretch yet!');

-- Tummy time (short sessions for a 2-month-old)
INSERT INTO tummy_time (child_id, start_time, end_time, milestone, notes) VALUES
  (2, '2025-03-13T09:00:00Z', '2025-03-13T09:05:00Z', 'Head lift', 'Lifting head well'),
  (2, '2025-03-13T15:00:00Z', '2025-03-13T15:03:00Z', NULL, 'Got fussy quickly'),
  (2, '2025-03-12T10:00:00Z', '2025-03-12T10:07:00Z', 'Looking around', NULL);

-- Pumping sessions
INSERT INTO pumping (child_id, start_time, end_time, amount, amount_unit, notes) VALUES
  (1, '2025-03-13T07:00:00Z', '2025-03-13T07:20:00Z', 5, 'oz', 'Morning pump'),
  (1, '2025-03-13T13:00:00Z', '2025-03-13T13:20:00Z', 4, 'oz', 'Afternoon pump'),
  (1, '2025-03-13T21:00:00Z', '2025-03-13T21:15:00Z', 3, 'oz', 'Evening pump'),
  (1, '2025-03-12T07:00:00Z', '2025-03-12T07:20:00Z', 5, 'oz', NULL),
  (1, '2025-03-12T13:00:00Z', '2025-03-12T13:15:00Z', 4, 'oz', NULL);

-- Growth for Liam
INSERT INTO growth (child_id, date, weight, weight_unit, height, height_unit, head_circumference, head_circumference_unit, notes) VALUES
  (2, '2025-01-10', 7.8, 'lb', 20.0, 'in', 13.8, 'in', 'Birth measurements'),
  (2, '2025-02-10', 10.2, 'lb', 21.5, 'in', 14.8, 'in', '1 month checkup'),
  (2, '2025-03-10', 12.5, 'lb', 23.0, 'in', 15.5, 'in', '2 month checkup');

-- Temperature for Liam
INSERT INTO temperature (child_id, time, reading, reading_unit, notes) VALUES
  (2, '2025-03-10T10:00:00Z', 98.4, 'F', 'Normal at checkup'),
  (2, '2025-03-10T22:00:00Z', 100.4, 'F', 'Post-vaccination fever'),
  (2, '2025-03-11T06:00:00Z', 99.0, 'F', 'Improving');

-- Notes for Liam
INSERT INTO notes (child_id, time, title, content) VALUES
  (2, '2025-03-10T11:00:00Z', '2 month checkup', 'Weight and height on track. Got first round of vaccines. Watch for fever.'),
  (2, '2025-03-12T14:00:00Z', 'Smiling!', 'Liam gave his first real social smile today!');

-- Active timer for Emma
INSERT INTO timers (child_id, user_id, name, start_time, is_active, notes)
SELECT 1, u.id, 'Nap', '2025-03-14T09:30:00Z', 1, 'Afternoon nap started'
FROM users u WHERE u.email = 'dev@example.com';
