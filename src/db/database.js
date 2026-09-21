import {
  mkdirSync,
} from 'node:fs';

import {
  dirname,
} from 'node:path';

import Database from 'better-sqlite3';

import {
  DatabaseError,
} from '../core/errors.js';

export function openDatabase({
  filePath,
  busyTimeoutMs = 5000,
} = {}) {
  if (!filePath) {
    throw new DatabaseError(
      'Database file path is required.',
    );
  }

  try {
    if (filePath !== ':memory:') {
      mkdirSync(
        dirname(filePath),
        {
          recursive: true,
        },
      );
    }

    const database = new Database(filePath);

    database.pragma('foreign_keys = ON');
    database.pragma(`busy_timeout = ${busyTimeoutMs}`);

    if (filePath !== ':memory:') {
      database.pragma('journal_mode = WAL');
      database.pragma('synchronous = NORMAL');
    }

    return database;
  } catch (error) {
    if (error instanceof DatabaseError) {
      throw error;
    }

    throw new DatabaseError(
      'Unable to open SQLite database.',
      {
        cause: error,
      },
    );
  }
}

export function closeDatabase(database) {
  if (!database?.open) {
    return;
  }

  try {
    database.close();
  } catch (error) {
    throw new DatabaseError(
      'Unable to close SQLite database.',
      {
        cause: error,
      },
    );
  }
}