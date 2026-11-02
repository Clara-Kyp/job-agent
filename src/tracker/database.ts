import Database from "better-sqlite3";
import { cfg } from "../config.js";
import type { ApplicationRecord, DraftedAnswer } from "../types/index.js";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";

/** Row shape from the SQLite applications table. */
interface DbApplicationRow {
  id: number;
  job_url: string;
  company: string;
  title: string;
  score: number;
  status: ApplicationRecord["status"];
  answers: string;
  created_at: string;
  updated_at: string;
}

let db: Database.Database | null = null;

/**
 * Initialize the SQLite database and create tables if needed.
 */
export function initDB(): Database.Database {
  if (db) return db;

  // Ensure the directory exists
  const dir = dirname(cfg.dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  db = new Database(cfg.dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_url TEXT NOT NULL,
      company TEXT NOT NULL,
      title TEXT NOT NULL,
      score REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'evaluated',
      answers TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
    CREATE INDEX IF NOT EXISTS idx_applications_job_url ON applications(job_url);
  `);

  return db;
}

/**
 * Save a new application record.
 */
export function saveApplication(record: Omit<ApplicationRecord, "id" | "createdAt" | "updatedAt">): number {
  const database = initDB();

  const stmt = database.prepare(`
    INSERT INTO applications (job_url, company, title, score, status, answers)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    record.jobUrl,
    record.company,
    record.title,
    record.score,
    record.status,
    JSON.stringify(record.answers || [])
  );

  console.log(`  💾 Saved application record (ID: ${result.lastInsertRowid})`);
  return result.lastInsertRowid as number;
}

/**
 * Update an application record's status.
 */
export function updateApplicationStatus(id: number, status: ApplicationRecord["status"]): void {
  const database = initDB();
  database
    .prepare(`UPDATE applications SET status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status, id);
}

/**
 * Get all application records.
 */
export function getApplications(): ApplicationRecord[] {
  const database = initDB();
  const rows = database.prepare("SELECT * FROM applications ORDER BY created_at DESC").all() as DbApplicationRow[];

  return rows.map((row) => ({
    id: row.id,
    jobUrl: row.job_url,
    company: row.company,
    title: row.title,
    score: row.score,
    status: row.status,
    answers: JSON.parse(row.answers || "[]") as DraftedAnswer[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Check if we already evaluated a specific job URL.
 */
export function hasApplication(jobUrl: string): boolean {
  const database = initDB();
  const row = database
    .prepare("SELECT id FROM applications WHERE job_url = ?")
    .get(jobUrl) as { id: number } | undefined;
  return !!row;
}

/**
 * Get summary statistics.
 */
export function getStats(): {
  total: number;
  byStatus: Record<string, number>;
  avgScore: number;
} {
  const database = initDB();

  const { count: total } = database
    .prepare("SELECT COUNT(*) as count FROM applications")
    .get() as { count: number };

  const statusRows = database
    .prepare("SELECT status, COUNT(*) as count FROM applications GROUP BY status")
    .all() as { status: string; count: number }[];
  const byStatus: Record<string, number> = {};
  for (const row of statusRows) {
    byStatus[row.status] = row.count;
  }

  const avgRow = database
    .prepare("SELECT AVG(score) as avg FROM applications")
    .get() as { avg: number | null } | undefined;
  const avgScore = avgRow?.avg || 0;

  return { total, byStatus, avgScore };
}
