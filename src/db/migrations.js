import {
  DatabaseError,
} from '../core/errors.js';

const MIGRATIONS = Object.freeze([
  {
    version: 1,
    name: 'create_jobs_and_claims',

    up(database) {
      database.exec(`
        CREATE TABLE jobs (
          id TEXT PRIMARY KEY,
          application_id TEXT NOT NULL UNIQUE,
          user_id TEXT,

          state TEXT NOT NULL
            CHECK (
              state IN (
                'PENDING',
                'CLAIMED',
                'WAITING_FOR_IP',
                'RUNNING',
                'WAITING_FOR_OTP',
                'WAITING_FOR_MANUAL_CHALLENGE',
                'RETRY_PENDING',
                'COMPLETED',
                'FAILED_FINAL',
                'CANCELLED'
              )
            ),

          current_step TEXT,
          retry_count INTEGER NOT NULL DEFAULT 0
            CHECK (retry_count >= 0),

          started_at TEXT,
          completed_at TEXT,

          last_activity_at TEXT NOT NULL,

          failure_code TEXT,
          failure_message TEXT,

          version INTEGER NOT NULL DEFAULT 1
            CHECK (version >= 1),

          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX idx_jobs_state
          ON jobs(state);

        CREATE INDEX idx_jobs_last_activity
          ON jobs(last_activity_at);

        CREATE TABLE claims (
          id TEXT PRIMARY KEY,
          application_id TEXT NOT NULL UNIQUE,
          job_id TEXT NOT NULL UNIQUE,

          status TEXT NOT NULL
            CHECK (
              status IN (
                'ACTIVE',
                'RELEASED'
              )
            ),

          claimed_at TEXT NOT NULL,
          released_at TEXT,

          FOREIGN KEY (job_id)
            REFERENCES jobs(id)
            ON DELETE RESTRICT
        );

        CREATE INDEX idx_claims_status
          ON claims(status);
      `);
    },
  },
]);

function ensureMigrationTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

export function migrateDatabase(database) {
  try {
    ensureMigrationTable(database);

    const appliedRows = database
      .prepare(`
        SELECT version
        FROM schema_migrations
        ORDER BY version
      `)
      .all();

    const appliedVersions = new Set(
      appliedRows.map((row) => row.version),
    );

    const insertMigration = database.prepare(`
      INSERT INTO schema_migrations (
        version,
        name,
        applied_at
      )
      VALUES (
        @version,
        @name,
        @appliedAt
      )
    `);

    const applyMigration = database.transaction(
      (migration) => {
        migration.up(database);

        insertMigration.run({
          version: migration.version,
          name: migration.name,
          appliedAt: new Date().toISOString(),
        });
      },
    );

    for (const migration of MIGRATIONS) {
      if (appliedVersions.has(migration.version)) {
        continue;
      }

      applyMigration(migration);
    }

    return getAppliedMigrations(database);
  } catch (error) {
    if (error instanceof DatabaseError) {
      throw error;
    }

    throw new DatabaseError(
      'Database migration failed.',
      {
        cause: error,
      },
    );
  }
}

export function getAppliedMigrations(database) {
  return database
    .prepare(`
      SELECT
        version,
        name,
        applied_at AS appliedAt
      FROM schema_migrations
      ORDER BY version
    `)
    .all();
}