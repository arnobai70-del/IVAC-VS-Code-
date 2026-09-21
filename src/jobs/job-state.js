import {
  InvalidJobTransitionError,
} from '../core/errors.js';

export const JOB_STATES = Object.freeze({
  PENDING: 'PENDING',
  CLAIMED: 'CLAIMED',
  WAITING_FOR_IP: 'WAITING_FOR_IP',
  RUNNING: 'RUNNING',
  WAITING_FOR_OTP: 'WAITING_FOR_OTP',
  WAITING_FOR_MANUAL_CHALLENGE:
    'WAITING_FOR_MANUAL_CHALLENGE',
  RETRY_PENDING: 'RETRY_PENDING',
  COMPLETED: 'COMPLETED',
  FAILED_FINAL: 'FAILED_FINAL',
  CANCELLED: 'CANCELLED',
});

const TERMINAL_STATES = new Set([
  JOB_STATES.COMPLETED,
  JOB_STATES.FAILED_FINAL,
  JOB_STATES.CANCELLED,
]);

const TRANSITIONS = Object.freeze({
  [JOB_STATES.PENDING]: Object.freeze([
    JOB_STATES.CLAIMED,
    JOB_STATES.CANCELLED,
  ]),

  [JOB_STATES.CLAIMED]: Object.freeze([
    JOB_STATES.WAITING_FOR_IP,
    JOB_STATES.CANCELLED,
  ]),

  [JOB_STATES.WAITING_FOR_IP]: Object.freeze([
    JOB_STATES.RUNNING,
    JOB_STATES.CANCELLED,
  ]),

  [JOB_STATES.RUNNING]: Object.freeze([
    JOB_STATES.WAITING_FOR_OTP,
    JOB_STATES.WAITING_FOR_MANUAL_CHALLENGE,
    JOB_STATES.RETRY_PENDING,
    JOB_STATES.COMPLETED,
    JOB_STATES.FAILED_FINAL,
    JOB_STATES.CANCELLED,
  ]),

  [JOB_STATES.WAITING_FOR_OTP]: Object.freeze([
    JOB_STATES.RUNNING,
    JOB_STATES.RETRY_PENDING,
    JOB_STATES.FAILED_FINAL,
    JOB_STATES.CANCELLED,
  ]),

  [JOB_STATES.WAITING_FOR_MANUAL_CHALLENGE]:
    Object.freeze([
      JOB_STATES.RUNNING,
      JOB_STATES.FAILED_FINAL,
      JOB_STATES.CANCELLED,
    ]),

  [JOB_STATES.RETRY_PENDING]: Object.freeze([
    JOB_STATES.RUNNING,
    JOB_STATES.FAILED_FINAL,
    JOB_STATES.CANCELLED,
  ]),

  [JOB_STATES.COMPLETED]: Object.freeze([]),
  [JOB_STATES.FAILED_FINAL]: Object.freeze([]),
  [JOB_STATES.CANCELLED]: Object.freeze([]),
});

export function isKnownJobState(state) {
  return Object.values(JOB_STATES).includes(state);
}

export function isTerminalJobState(state) {
  return TERMINAL_STATES.has(state);
}

export function canTransitionJobState(
  fromState,
  toState,
) {
  if (
    !isKnownJobState(fromState)
    || !isKnownJobState(toState)
  ) {
    return false;
  }

  return TRANSITIONS[fromState].includes(toState);
}

export function assertJobTransition(
  fromState,
  toState,
) {
  if (!canTransitionJobState(fromState, toState)) {
    throw new InvalidJobTransitionError(
      fromState,
      toState,
    );
  }
}