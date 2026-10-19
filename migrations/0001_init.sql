CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

-- Chores are archived instead of deleted so history keeps their names.
CREATE TABLE chores (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  image TEXT,
  points INTEGER NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- points is copied from the chore at completion time, so later edits
-- to a chore's points never rewrite past weeks.
CREATE TABLE completions (
  id INTEGER PRIMARY KEY,
  chore_id INTEGER NOT NULL REFERENCES chores(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  points INTEGER NOT NULL,
  done_at INTEGER NOT NULL
);
CREATE INDEX completions_done_at ON completions(done_at);

CREATE TABLE login_attempts (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX login_attempts_ip_at ON login_attempts(ip, at);

-- Bumped on every chore change so clients know when to refetch chores.
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO meta (key, value) VALUES ('chores_rev', 1);

INSERT INTO chores (name, icon, points, sort, created_at) VALUES
  ('Load dishwasher',     '🍽️', 5,  1,  0),
  ('Unload dishwasher',   '🥣', 5,  2,  0),
  ('Clean toilet',        '🚽', 15, 3,  0),
  ('Wash clothes',        '🧺', 5,  4,  0),
  ('Dry clothes',         '👕', 5,  5,  0),
  ('Fold clothes',        '🧦', 8,  6,  0),
  ('Put clothes away',    '🗄️', 5,  7,  0),
  ('Make bed',            '🛏️', 3,  8,  0),
  ('Change bed linens',   '🛌', 12, 9,  0),
  ('Vacuum rooms',        '🧹', 10, 10, 0),
  ('Dust furniture',      '🪶', 8,  11, 0),
  ('Grocery shopping',    '🛒', 15, 12, 0),
  ('Take out trash',      '🗑️', 3,  13, 0);
