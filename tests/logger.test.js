import assert from 'node:assert/strict';
import test from 'node:test';
import { Writable } from 'node:stream';

import {
  createLogger,
} from '../src/core/logger.js';

function createCaptureStream() {
  const chunks = [];

  const stream = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });

  return {
    stream,

    read() {
      return chunks.join('');
    },
  };
}

test('logger redacts sensitive fields', async () => {
  const capture = createCaptureStream();

  const logger = createLogger({
    level: 'info',
    service: 'logger-test',
    destination: capture.stream,
  });

  logger.info(
    {
      headers: {
        authorization: 'Bearer secret-token',
      },

      job: {
        password: 'secret-password',
      },

      otp: {
        code: '123456',
      },

      secrets: {
        portalApiAccessToken:
          'secret-portal-token',
      },
    },
    'Sensitive data test',
  );

  await new Promise((resolve) => {
    setImmediate(resolve);
  });

  const output = capture.read();

  assert.equal(
    output.includes('Bearer secret-token'),
    false,
  );

  assert.equal(
    output.includes('secret-password'),
    false,
  );

  assert.equal(
    output.includes('123456'),
    false,
  );

  assert.equal(
    output.includes('secret-portal-token'),
    false,
  );

  assert.equal(
    output.includes('[REDACTED]'),
    true,
  );
});