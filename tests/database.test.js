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
  const database = openDatabase({
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

    assert.equal(result, 1);
  } finally {
    closeDatabase(database);
  }
});

test('migrations are idempotent', () => {
  const database = openDatabase({
    filePath: ':memory:',
  });

  try {
    migrateDatabase(database);
    migrateDatabase(database);

    const migrations =
      getAppliedMigrations(database);

    assert.equal(migrations.length, 1);
    assert.equal(migrations[0].version, 1);
    assert.equal(
      migrations[0].name,
      'create_jobs_and_claims',
    );
  } finally {
    closeDatabase(database);
  }
});

test('migration creates jobs and claims tables', () => {
  const database = openDatabase({
    filePath: ':memory:',
  });

  try {
    migrateDatabase(database);

    const rows = database
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE
          type = 'table'
          AND name IN (
            'jobs',
            'claims',
            'schema_migrations'
          )
        ORDER BY name
      `)
      .all();

    assert.deepEqual(
      rows.map((row) => row.name),
      [
        'claims',
        'jobs',
        'schema_migrations',
      ],
    );
  } finally {
    closeDatabase(database);
  }
});