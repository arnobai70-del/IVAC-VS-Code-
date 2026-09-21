import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ConfigError,
  ERROR_CODES,
  isAppError,
  serializeError,
} from '../src/core/errors.js';

test('ConfigError uses the expected structured error code', () => {
  const error = new ConfigError('Invalid configuration');

  assert.equal(error.code, ERROR_CODES.CONFIG_ERROR);
  assert.equal(error.retryable, false);
  assert.equal(isAppError(error), true);
});

test('serializeError exposes only safe error metadata', () => {
  const error = new ConfigError(
    'Configuration failed',
    {
      details: {
        secret: 'must-not-be-serialized',
      },
    },
  );

  const serialized = serializeError(error);

  assert.deepEqual(serialized, {
    name: 'ConfigError',
    code: ERROR_CODES.CONFIG_ERROR,
    message: 'Configuration failed',
    retryable: false,
  });

  assert.equal(
    JSON.stringify(serialized).includes(
      'must-not-be-serialized',
    ),
    false,
  );
});