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

  {
    version: 2,
    name: 'create_proxy_pool_and_ip_allocations',

    up(database) {
      database.exec(`
        CREATE TABLE proxies (
          id TEXT PRIMARY KEY,

          ip TEXT NOT NULL,
          port INTEGER NOT NULL
            CHECK (
              port >= 1
              AND port <= 65535
            ),

          protocol TEXT NOT NULL
            CHECK (
              protocol IN (
                'http',
                'https'
              )
            ),

          label TEXT,

          enabled INTEGER NOT NULL DEFAULT 1
            CHECK (
              enabled IN (
                0,
                1
              )
            ),

          status TEXT NOT NULL
            CHECK (
              status IN (
                'AVAILABLE',
                'RESERVED',
                'ACTIVE',
                'RETRY_RESERVED',
                'COOLDOWN',
                'DISABLED',
                'RELEASING'
              )
            ),

          last_health_ok INTEGER NOT NULL DEFAULT 0
            CHECK (
              last_health_ok IN (
                0,
                1
              )
            ),

          last_health_at TEXT,
          latency_ms INTEGER,

          success_count INTEGER NOT NULL DEFAULT 0
            CHECK (
              success_count >= 0
            ),

          failure_count INTEGER NOT NULL DEFAULT 0
            CHECK (
              failure_count >= 0
            ),

          cooldown_until TEXT,
          last_error TEXT,

          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,

          UNIQUE (
            ip,
            port
          )
        );

        CREATE INDEX idx_proxies_status
          ON proxies(
            enabled,
            status,
            last_health_ok
          );

        CREATE TABLE ip_allocations (
          id TEXT PRIMARY KEY,

          job_id TEXT NOT NULL,
          user_id TEXT,
          proxy_id TEXT NOT NULL,

          ip TEXT NOT NULL,
          port INTEGER NOT NULL,

          status TEXT NOT NULL
            CHECK (
              status IN (
                'RESERVED',
                'ACTIVE',
                'RETRY_RESERVED',
                'RELEASING',
                'RELEASED'
              )
            ),

          allocated_at TEXT NOT NULL,
          activated_at TEXT,
          last_heartbeat TEXT,

          released_at TEXT,
          release_reason TEXT,

          failure_count INTEGER NOT NULL DEFAULT 0
            CHECK (
              failure_count >= 0
            ),

          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,

          FOREIGN KEY (job_id)
            REFERENCES jobs(id)
            ON DELETE RESTRICT,

          FOREIGN KEY (proxy_id)
            REFERENCES proxies(id)
            ON DELETE RESTRICT
        );

        CREATE INDEX idx_ip_allocations_job
          ON ip_allocations(job_id);

        CREATE INDEX idx_ip_allocations_proxy
          ON ip_allocations(proxy_id);

        CREATE UNIQUE INDEX uq_live_allocation_proxy
          ON ip_allocations(proxy_id)
          WHERE status IN (
            'RESERVED',
            'ACTIVE',
            'RETRY_RESERVED',
            'RELEASING'
          );

        CREATE UNIQUE INDEX uq_live_allocation_job
          ON ip_allocations(job_id)
          WHERE status IN (
            'RESERVED',
            'ACTIVE',
            'RETRY_RESERVED',
            'RELEASING'
          );
      `);
    },
  },

  {
    version: 3,
    name: 'create_portal_intake_reservations',

    up(database) {
      database.exec(`
        CREATE TABLE portal_intake_reservations (
          id TEXT PRIMARY KEY,

          proxy_id TEXT NOT NULL,

          ip TEXT NOT NULL,
          port INTEGER NOT NULL,

          status TEXT NOT NULL
            CHECK (
              status IN (
                'RESERVED',
                'CONSUMED',
                'RELEASED'
              )
            ),

          job_id TEXT,

          reserved_at TEXT NOT NULL,
          consumed_at TEXT,
          released_at TEXT,
          release_reason TEXT,

          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,

          FOREIGN KEY (proxy_id)
            REFERENCES proxies(id)
            ON DELETE RESTRICT,

          FOREIGN KEY (job_id)
            REFERENCES jobs(id)
            ON DELETE RESTRICT
        );

        CREATE INDEX idx_portal_intake_reservations_status
          ON portal_intake_reservations(status);

        CREATE INDEX idx_portal_intake_reservations_job
          ON portal_intake_reservations(job_id);

        CREATE UNIQUE INDEX uq_reserved_portal_intake_proxy
          ON portal_intake_reservations(proxy_id)
          WHERE status = 'RESERVED';
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