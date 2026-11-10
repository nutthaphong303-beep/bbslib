CREATE TABLE IF NOT EXISTS papers (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  year INTEGER,
  keywords TEXT,
  pdf_key TEXT NOT NULL,
  cover_key TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_papers_created ON papers(created_at);
