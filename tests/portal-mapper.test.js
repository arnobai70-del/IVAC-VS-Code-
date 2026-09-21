import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ERROR_CODES,
} from '../src/core/errors.js';

import {
  PortalMapper,
} from '../src/portal/portal-mapper.js';

const mapper =
  new PortalMapper({
    applicationId:
      'application.id',

    userId:
      'user.id',

    phone:
      'user.phone',

    password:
      'credentials.password',

    passportNumber:
      'passport.number',

    documents:
      'documents',
  });

test('Portal mapper normalizes application fields centrally', () => {
  const result =
    mapper.normalizeApplication({
      application: {
        id: 12345,
      },

      user: {
        id: 'user-1',
        phone: ' 01700000000 ',
      },

      credentials: {
        password: 'secret',
      },

      passport: {
        number: 'AB1234567',
      },

      documents: [
        {
          id: 'doc-1',
        },
      ],
    });

  assert.deepEqual(
    result,
    {
      applicationId: '12345',
      userId: 'user-1',
      phone: '01700000000',
      password: 'secret',
      passportNumber: 'AB1234567',
      documents: [
        {
          id: 'doc-1',
        },
      ],
    },
  );
});

test('Portal mapper rejects missing application id', () => {
  assert.throws(
    () => {
      mapper.normalizeApplication({
        application: {},
      });
    },

    (error) => (
      error.code
      === ERROR_CODES.PORTAL_RESPONSE_ERROR
    ),
  );
});

test('Portal mapper rejects multi-application destructive responses', () => {
  assert.throws(
    () => {
      mapper.normalizeApplication([
        {
          application: {
            id: 'app-1',
          },
        },
        {
          application: {
            id: 'app-2',
          },
        },
      ]);
    },

    (error) => (
      error.code
      === ERROR_CODES.PORTAL_RESPONSE_ERROR
    ),
  );
});