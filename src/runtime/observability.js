import {
  JOB_STATES,
} from '../jobs/job-state.js';

import {
  FINAL_RESULT_DELIVERY_STATUSES,
} from '../results/final-result-store.js';


const OBSERVABLE_JOB_STATES =
  Object.freeze([
    JOB_STATES.PENDING,
    JOB_STATES.CLAIMED,
    JOB_STATES.WAITING_FOR_IP,
    JOB_STATES.RUNNING,
    JOB_STATES.WAITING_FOR_OTP,
    JOB_STATES
      .WAITING_FOR_MANUAL_CHALLENGE,
    JOB_STATES.RETRY_PENDING,
  ]);


function requireObject(
  value,
  name,
) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(
      value,
    )
  ) {
    throw new TypeError(
      `${name} must be an object.`,
    );
  }

  return value;
}


function requireFunction(
  value,
  name,
) {
  if (
    typeof value !== 'function'
  ) {
    throw new TypeError(
      `${name} must be a function.`,
    );
  }

  return value;
}


function requireArray(
  value,
  name,
) {
  if (
    !Array.isArray(
      value,
    )
  ) {
    throw new TypeError(
      `${name} must be an array.`,
    );
  }

  return value;
}


function requireCount(
  value,
  name,
) {
  if (
    !Number.isSafeInteger(
      value,
    )
    || value < 0
  ) {
    throw new TypeError(
      `${name} must be a non-negative safe integer.`,
    );
  }

  return value;
}


function requireBoolean(
  value,
  name,
) {
  if (
    typeof value !== 'boolean'
  ) {
    throw new TypeError(
      `${name} must be a boolean.`,
    );
  }

  return value;
}


function normalizeDate(
  value,
) {
  const date =
    value instanceof Date
      ? value
      : new Date(
          value,
        );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    throw new TypeError(
      'Observability clock must return a valid date.',
    );
  }

  return date;
}


function freezeRecord(
  value,
) {
  if (
    value === null
    || typeof value !== 'object'
    || Object.isFrozen(
      value,
    )
  ) {
    return value;
  }

  for (
    const child
    of Object.values(
      value,
    )
  ) {
    freezeRecord(
      child,
    );
  }

  return Object.freeze(
    value,
  );
}


function createJobStateCounts(
  jobs,
) {
  const counts =
    Object.create(
      null,
    );

  for (
    const state
    of OBSERVABLE_JOB_STATES
  ) {
    counts[state] =
      0;
  }

  for (
    const job
    of jobs
  ) {
    if (
      !job
      || typeof job !== 'object'
      || Array.isArray(
        job,
      )
    ) {
      throw new TypeError(
        'jobStore.listIncompleteJobs() returned an invalid job.',
      );
    }

    const state =
      job.state;

    if (
      typeof state !== 'string'
      || !OBSERVABLE_JOB_STATES
        .includes(
          state,
        )
    ) {
      throw new TypeError(
        'Incomplete job has an unsupported observable state.',
      );
    }

    counts[state] +=
      1;
  }

  return counts;
}


function readExecutionStatus(
  executionWorker,
) {
  const status =
    executionWorker
      .getStatus();

  requireObject(
    status,
    'executionWorker.getStatus()',
  );

  return {
    inFlight:
      requireCount(
        status.inFlight,
        'executionWorker status.inFlight',
      ),

    memoryContexts:
      requireCount(
        status.memoryContexts,
        'executionWorker status.memoryContexts',
      ),
  };
}


function readHandlerStatus(
  intakeExecutionHandler,
) {
  const status =
    intakeExecutionHandler
      .getStatus();

  requireObject(
    status,
    'intakeExecutionHandler.getStatus()',
  );

  const manualResume =
    requireObject(
      status.manualResume,
      'intake execution status.manualResume',
    );

  return {
    stopped:
      requireBoolean(
        status.stopped,
        'intake execution status.stopped',
      ),

    handling:
      requireBoolean(
        status.handling,
        'intake execution status.handling',
      ),

    activeExecutions:
      requireCount(
        status.activeExecutions,
        'intake execution status.activeExecutions',
      ),

    activeJobs:
      requireCount(
        status.activeJobs,
        'intake execution status.activeJobs',
      ),

    completedCycles:
      requireCount(
        status.completedCycles,
        'intake execution status.completedCycles',
      ),

    totalAdmitted:
      requireCount(
        status.totalAdmitted,
        'intake execution status.totalAdmitted',
      ),

    totalWorkflowCompleted:
      requireCount(
        status.totalWorkflowCompleted,
        'intake execution status.totalWorkflowCompleted',
      ),

    totalFailed:
      requireCount(
        status.totalFailed,
        'intake execution status.totalFailed',
      ),

    totalManualChallenges:
      requireCount(
        status.totalManualChallenges,
        'intake execution status.totalManualChallenges',
      ),

    manualResume: {
      total:
        requireCount(
          manualResume.total,
          'manualResume.total',
        ),

      completed:
        requireCount(
          manualResume.completed,
          'manualResume.completed',
        ),

      failed:
        requireCount(
          manualResume.failed,
          'manualResume.failed',
        ),

      manualChallenges:
        requireCount(
          manualResume.manualChallenges,
          'manualResume.manualChallenges',
        ),

      aborted:
        requireCount(
          manualResume.aborted,
          'manualResume.aborted',
        ),
    },
  };
}


function countFinalResults(
  finalResultStore,
) {
  const statuses = {
    pending:
      FINAL_RESULT_DELIVERY_STATUSES
        .PENDING,

    inFlight:
      FINAL_RESULT_DELIVERY_STATUSES
        .IN_FLIGHT,

    uncertain:
      FINAL_RESULT_DELIVERY_STATUSES
        .UNCERTAIN,

    delivered:
      FINAL_RESULT_DELIVERY_STATUSES
        .DELIVERED,
  };

  const counts = {};

  for (
    const [
      name,
      deliveryStatus,
    ]
    of Object.entries(
      statuses,
    )
  ) {
    const records =
      finalResultStore
        .listByDeliveryStatus(
          deliveryStatus,
        );

    requireArray(
      records,
      `finalResultStore.listByDeliveryStatus(${deliveryStatus})`,
    );

    counts[name] =
      records.length;
  }

  return counts;
}


/*
 * Phase 36 bounded observability snapshot.
 *
 * This module intentionally exposes aggregate operational state only.
 *
 * It never returns:
 *
 * - Portal credentials;
 * - passwords;
 * - OTP values;
 * - cookies;
 * - bearer tokens;
 * - workflow input;
 * - application payloads;
 * - HTTP response bodies;
 * - proxy host/username/password;
 * - assigned IP addresses;
 * - dispatcher/session objects;
 * - JobContext objects;
 * - final-result payloads or idempotency material.
 *
 * The snapshot is suitable for a read-only operational surface.
 * Any malformed provider state fails closed instead of silently
 * projecting arbitrary internal objects.
 */
export class RuntimeObservability {
  constructor({
    jobStore,
    ipAllocator,
    proxyPool,
    finalResultStore,
    executionWorker,
    intakeExecutionHandler,
    clock =
      () =>
        new Date(),
  }) {
    requireObject(
      jobStore,
      'jobStore',
    );

    requireFunction(
      jobStore.listIncompleteJobs,
      'jobStore.listIncompleteJobs',
    );

    requireObject(
      ipAllocator,
      'ipAllocator',
    );

    requireFunction(
      ipAllocator.listLiveAllocations,
      'ipAllocator.listLiveAllocations',
    );

    requireObject(
      proxyPool,
      'proxyPool',
    );

    requireFunction(
      proxyPool.listProxies,
      'proxyPool.listProxies',
    );

    requireFunction(
      proxyPool.countHealthyAvailable,
      'proxyPool.countHealthyAvailable',
    );

    requireObject(
      finalResultStore,
      'finalResultStore',
    );

    requireFunction(
      finalResultStore.listByDeliveryStatus,
      'finalResultStore.listByDeliveryStatus',
    );

    requireObject(
      executionWorker,
      'executionWorker',
    );

    requireFunction(
      executionWorker.getStatus,
      'executionWorker.getStatus',
    );

    requireObject(
      intakeExecutionHandler,
      'intakeExecutionHandler',
    );

    requireFunction(
      intakeExecutionHandler.getStatus,
      'intakeExecutionHandler.getStatus',
    );

    requireFunction(
      clock,
      'clock',
    );

    this.jobStore =
      jobStore;

    this.ipAllocator =
      ipAllocator;

    this.proxyPool =
      proxyPool;

    this.finalResultStore =
      finalResultStore;

    this.executionWorker =
      executionWorker;

    this.intakeExecutionHandler =
      intakeExecutionHandler;

    this.clock =
      clock;
  }


  snapshot() {
    const jobs =
      requireArray(
        this.jobStore
          .listIncompleteJobs(),
        'jobStore.listIncompleteJobs()',
      );

    const allocations =
      requireArray(
        this.ipAllocator
          .listLiveAllocations(),
        'ipAllocator.listLiveAllocations()',
      );

    const proxies =
      requireArray(
        this.proxyPool
          .listProxies(),
        'proxyPool.listProxies()',
      );

    const healthyAvailable =
      requireCount(
        this.proxyPool
          .countHealthyAvailable(),
        'proxyPool.countHealthyAvailable()',
      );

    if (
      healthyAvailable
      > proxies.length
    ) {
      throw new TypeError(
        'Healthy available proxy count cannot exceed total proxy count.',
      );
    }

    const execution =
      readExecutionStatus(
        this.executionWorker,
      );

    const handler =
      readHandlerStatus(
        this.intakeExecutionHandler,
      );

    const finalResults =
      countFinalResults(
        this.finalResultStore,
      );

    const jobStates =
      createJobStateCounts(
        jobs,
      );

    const checkedAt =
      normalizeDate(
        this.clock(),
      )
        .toISOString();

    const snapshot = {
      checkedAt,

      runtime: {
        stopped:
          handler.stopped,

        handlingCycle:
          handler.handling,

        inFlight:
          execution.inFlight,

        memoryContexts:
          execution.memoryContexts,

        activeExecutions:
          handler.activeExecutions,

        activeJobs:
          handler.activeJobs,
      },

      throughput: {
        completedCycles:
          handler.completedCycles,

        admitted:
          handler.totalAdmitted,

        workflowCompleted:
          handler.totalWorkflowCompleted,

        failed:
          handler.totalFailed,

        manualChallenges:
          handler.totalManualChallenges,
      },

      manualResume: {
        total:
          handler.manualResume
            .total,

        completed:
          handler.manualResume
            .completed,

        failed:
          handler.manualResume
            .failed,

        manualChallenges:
          handler.manualResume
            .manualChallenges,

        aborted:
          handler.manualResume
            .aborted,
      },

      jobs: {
        incomplete:
          jobs.length,

        byState:
          jobStates,

        waitingForManualChallenge:
          jobStates[
            JOB_STATES
              .WAITING_FOR_MANUAL_CHALLENGE
          ],
      },

      network: {
        liveAllocations:
          allocations.length,

        proxies:
          proxies.length,

        healthyAvailable,
      },

      finalResults: {
        pending:
          finalResults.pending,

        inFlight:
          finalResults.inFlight,

        uncertain:
          finalResults.uncertain,

        delivered:
          finalResults.delivered,
      },

      safety: {
        readOnly:
          true,

        rawPayloads:
          false,

        credentialExposure:
          false,

        otpExposure:
          false,

        cookieExposure:
          false,

        proxyAddressExposure:
          false,

        automaticManualChallengeResume:
          false,

        replacementIpAcquisition:
          false,
      },
    };

    return freezeRecord(
      snapshot,
    );
  }
}