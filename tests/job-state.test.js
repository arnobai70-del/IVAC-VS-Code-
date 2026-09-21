import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ERROR_CODES,
} from '../src/core/errors.js';

import {
  assertJobTransition,
  canTransitionJobState,
  isTerminalJobState,
  JOB_STATES,
} from '../src/jobs/job-state.js';

test('valid job state transitions are allowed', () => {
  assert.equal(
    canTransitionJobState(
      JOB_STATES.PENDING,
      JOB_STATES.CLAIMED,
    ),
    true,
  );

  assert.equal(
    canTransitionJobState(
      JOB_STATES.RUNNING,
      JOB_STATES.RETRY_PENDING,
    ),
    true,
  );

  assert.equal(
    canTransitionJobState(
      JOB_STATES.RETRY_PENDING,
      JOB_STATES.RUNNING,
    ),
    true,
  );
});

test('invalid state jumps are rejected', () => {
  assert.equal(
    canTransitionJobState(
      JOB_STATES.PENDING,
      JOB_STATES.COMPLETED,
    ),
    false,
  );

  assert.throws(
    () => {
      assertJobTransition(
        JOB_STATES.PENDING,
        JOB_STATES.COMPLETED,
      );
    },
    (error) => (
      error.code
      === ERROR_CODES.INVALID_JOB_TRANSITION
    ),
  );
});

test('terminal states cannot transition', () => {
  for (const terminalState of [
    JOB_STATES.COMPLETED,
    JOB_STATES.FAILED_FINAL,
    JOB_STATES.CANCELLED,
  ]) {
    assert.equal(
      isTerminalJobState(terminalState),
      true,
    );

    assert.equal(
      canTransitionJobState(
        terminalState,
        JOB_STATES.RUNNING,
      ),
      false,
    );
  }
});