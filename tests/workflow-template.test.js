import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ERROR_CODES,
} from '../src/core/errors.js';

import {
  renderTemplate,
} from '../src/workflow/template.js';

const context = {
  input: {
    phone:
      '01700000000',

    password:
      'secret-value',
  },

  job: {
    id:
      'job-1',

    applicationId:
      'app-1',
  },

  allocation: {
    ip:
      '203.0.113.50',
  },

  session: {
    assignedIp:
      '203.0.113.50',
  },

  responses: {
    login: {
      statusCode:
        200,

      data: {
        token:
          'abc-token',

        nested: {
          number: 42,
        },
      },
    },
  },

  otp: {
    code:
      '654321',
  },
};

test('workflow templates recursively resolve safe context values', () => {
  const result =
    renderTemplate(
      {
        phone:
          '{{input.phone}}',

        authorization:
          'Bearer {{responses.login.data.token}}',

        count:
          '{{responses.login.data.nested.number}}',

        items: [
          '{{job.applicationId}}',
          '{{otp.code}}',
        ],
      },
      context,
    );

  assert.deepEqual(
    result,
    {
      phone:
        '01700000000',

      authorization:
        'Bearer abc-token',

      count:
        42,

      items: [
        'app-1',
        '654321',
      ],
    },
  );
});

test('TEST L: workflow template engine rejects unsafe prototype access and does not evaluate code', () => {
  assert.throws(
    () => {
      renderTemplate(
        '{{input.constructor}}',
        context,
      );
    },

    (error) =>
      error.code
      === ERROR_CODES
        .WORKFLOW_TEMPLATE_ERROR,
  );

  const literal =
    renderTemplate(
      'value-${process.exit(1)}',
      context,
    );

  assert.equal(
    literal,
    'value-${process.exit(1)}',
  );
});

test('missing template value fails closed', () => {
  assert.throws(
    () => {
      renderTemplate(
        '{{responses.unknown.data}}',
        context,
      );
    },

    (error) =>
      error.code
      === ERROR_CODES
        .WORKFLOW_TEMPLATE_ERROR,
  );
});