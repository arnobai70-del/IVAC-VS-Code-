import assert from 'node:assert/strict';
import test from 'node:test';

import {
  closeDatabase,
  openDatabase,
} from '../src/db/database.js';

import {
  getAppliedMigrations,
  migrateDatabase,
} from '../src/db/migrations.js';

test('database enables foreign keys', () => {
  const database =
    openDatabase({
      filePath: ':memory:',
    });

  try {
    const result =
      database.pragma(
        'foreign_keys',
        {
          simple: true,
        },
      );

    assert.equal(
      result,
      1,
    );
  } finally {
    closeDatabase(
      database,
    );
  }
});

test('migrations are idempotent', () => {
  const database =
    openDatabase({
      filePath: ':memory:',
    });

  try {
    migrateDatabase(
      database,
    );

    migrateDatabase(
      database,
    );

    const migrations =
      getAppliedMigrations(
        database,
      );

    assert.equal(
      migrations.length,
      5,
    );

    assert.equal(
      migrations.at(-1)
        .version,
      5,
    );

    assert.equal(
      migrations.at(-1)
        .name,
      'create_job_recovery_metadata',
    );
  } finally {
    closeDatabase(
      database,
    );
  }
});

test('migrations create durable job, network, intake, final-result, and recovery tables', () => {
  const database =
    openDatabase({
      filePath: ':memory:',
    });

  try {
    migrateDatabase(
      database,
    );

    const rows =
      database
        .prepare(`
          SELECT name
          FROM sqlite_master
          WHERE
            type = 'table'
            AND name IN (
              'jobs',
              'claims',
              'proxies',
              'ip_allocations',
              'portal_intake_reservations',
              'final_results',
              'job_recovery',
              'schema_migrations'
            )
          ORDER BY name
        `)
        .all();

    assert.deepEqual(
      rows.map(
        (row) => row.name,
      ),
      [
        'claims',
        'final_results',
        'ip_allocations',
        'job_recovery',
        'jobs',
        'portal_intake_reservations',
        'proxies',
        'schema_migrations',
      ],
    );
  } finally {
    closeDatabase(
      database,
    );
  }
});