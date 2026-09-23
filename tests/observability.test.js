import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RuntimeObservability,
} from '../src/runtime/observability.js';

import {
  JOB_STATES,
} from '../src/jobs/job-state.js';

import {
  FINAL_RESULT_DELIVERY_STATUSES,
} from '../src/results/final-result-store.js';


function createHarness({
  jobs,
  allocations,
  proxies,
  healthyAvailable,
  finalResults,
  executionStatus,
  handlerStatus,
  clock,
} = {}) {
  const currentJobs =
    jobs === undefined
      ? [
      {
        id:
          'job-1',

        state:
          JOB_STATES.RUNNING,

        password:
          'must-not-leak',

        otp:
          '123456',

        cookie:
          'session-secret',
      },

      {
        id:
          'job-2',

        state:
          JOB_STATES
            .WAITING_FOR_MANUAL_CHALLENGE,

        Authorization:
          'Bearer secret',
      },

      {
        id:
          'job-3',

        state:
          JOB_STATES.RETRY_PENDING,
      },
    ]
      : jobs;

  const currentAllocations =
    allocations
    ?? [
      {
        allocationId:
          'allocation-1',

        jobId:
          'job-1',

        ip:
          '203.0.113.10',

        username:
          'proxy-user',

        password:
          'proxy-password',
      },

      {
        allocationId:
          'allocation-2',

        jobId:
          'job-2',

        ip:
          '203.0.113.11',
      },
    ];

  const currentProxies =
    proxies
    ?? [
      {
        id:
          'proxy-1',

        host:
          'proxy-one.example',

        username:
          'proxy-user',

        password:
          'proxy-password',
      },

      {
        id:
          'proxy-2',

        host:
          'proxy-two.example',
      },

      {
        id:
          'proxy-3',

        host:
          'proxy-three.example',
      },
    ];

  const currentHealthyAvailable =
    healthyAvailable
    ?? 2;

  const currentFinalResults =
    finalResults
    ?? [
      {
        id:
          'result-1',

        deliveryStatus:
          FINAL_RESULT_DELIVERY_STATUSES
            .PENDING,

        payload:
          {
            password:
              'must-not-leak',
          },

        payloadHash:
          'hash-secret',
      },

      {
        id:
          'result-2',

        deliveryStatus:
          FINAL_RESULT_DELIVERY_STATUSES
            .IN_FLIGHT,

        idempotencyKey:
          'idem-secret',
      },

      {
        id:
          'result-3',

        deliveryStatus:
          FINAL_RESULT_DELIVERY_STATUSES
            .UNCERTAIN,
      },

      {
        id:
          'result-4',

        deliveryStatus:
          FINAL_RESULT_DELIVERY_STATUSES
            .DELIVERED,
      },

      {
        id:
          'result-5',

        deliveryStatus:
          FINAL_RESULT_DELIVERY_STATUSES
            .DELIVERED,
      },
    ];

  const currentExecutionStatus =
    executionStatus
    ?? {
      inFlight:
        1,

      memoryContexts:
        2,

      secretContext:
        {
          cookie:
            'must-not-leak',
        },
    };

  const currentHandlerStatus =
    handlerStatus
    ?? {
      stopped:
        false,

      handling:
        true,

      activeExecutions:
        1,

      activeJobs:
        1,

      completedCycles:
        7,

      totalAdmitted:
        12,

      totalWorkflowCompleted:
        8,

      totalFailed:
        2,

      totalManualChallenges:
        3,

      manualResume: {
        total:
          4,

        completed:
          2,

        failed:
          1,

        manualChallenges:
          1,

        aborted:
          0,

        last: {
          errorCode:
            'must-not-be-forwarded',
        },
      },

      lastCycle: {
        payload:
          'must-not-be-forwarded',
      },
    };

  const jobStore = {
    listIncompleteJobs() {
      return currentJobs;
    },
  };

  const ipAllocator = {
    listLiveAllocations() {
      return currentAllocations;
    },
  };

  const proxyPool = {
    listProxies() {
      return currentProxies;
    },

    countHealthyAvailable() {
      return currentHealthyAvailable;
    },
  };

  const finalResultStore = {
    listByDeliveryStatus(
      deliveryStatus,
    ) {
      return currentFinalResults
        .filter(
          (record) =>
            record.deliveryStatus
            === deliveryStatus,
        );
    },
  };

  const executionWorker = {
    getStatus() {
      return currentExecutionStatus;
    },
  };

  const intakeExecutionHandler = {
    getStatus() {
      return currentHandlerStatus;
    },
  };

  const service =
    new RuntimeObservability({
      jobStore,
      ipAllocator,
      proxyPool,
      finalResultStore,
      executionWorker,
      intakeExecutionHandler,

      clock:
        clock
        ?? (
          () =>
            new Date(
              '2026-09-23T02:00:00.000Z',
            )
        ),
    });

  return {
    service,

    dependencies: {
      jobStore,
      ipAllocator,
      proxyPool,
      finalResultStore,
      executionWorker,
      intakeExecutionHandler,
    },
  };
}


test(
  'observability snapshot exposes bounded aggregate runtime state',
  () => {
    const {
      service,
    } =
      createHarness();

    const snapshot =
      service.snapshot();

    assert.deepEqual(
      {
        ...snapshot,

        jobs: {
          ...snapshot.jobs,

          byState: {
            ...snapshot.jobs.byState,
          },
        },
      },
      {
        checkedAt:
          '2026-09-23T02:00:00.000Z',

        runtime: {
          stopped:
            false,

          handlingCycle:
            true,

          inFlight:
            1,

          memoryContexts:
            2,

          activeExecutions:
            1,

          activeJobs:
            1,
        },

        throughput: {
          completedCycles:
            7,

          admitted:
            12,

          workflowCompleted:
            8,

          failed:
            2,

          manualChallenges:
            3,
        },

        manualResume: {
          total:
            4,

          completed:
            2,

          failed:
            1,

          manualChallenges:
            1,

          aborted:
            0,
        },

        jobs: {
          incomplete:
            3,

          byState: {
            [JOB_STATES.PENDING]:
              0,

            [JOB_STATES.CLAIMED]:
              0,

            [JOB_STATES.WAITING_FOR_IP]:
              0,

            [JOB_STATES.RUNNING]:
              1,

            [JOB_STATES.WAITING_FOR_OTP]:
              0,

            [JOB_STATES
              .WAITING_FOR_MANUAL_CHALLENGE]:
              1,

            [JOB_STATES.RETRY_PENDING]:
              1,
          },

          waitingForManualChallenge:
            1,
        },

        network: {
          liveAllocations:
            2,

          proxies:
            3,

          healthyAvailable:
            2,
        },

        finalResults: {
          pending:
            1,

          inFlight:
            1,

          uncertain:
            1,

          delivered:
            2,
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
      },
    );
  },
);


test(
  'observability snapshot never forwards provider secrets or raw payloads',
  () => {
    const {
      service,
    } =
      createHarness();

    const serialized =
      JSON.stringify(
        service.snapshot(),
      );

    assert.doesNotMatch(
      serialized,
      /must-not-leak/i,
    );

    assert.doesNotMatch(
      serialized,
      /123456/,
    );

    assert.doesNotMatch(
      serialized,
      /session-secret/i,
    );

    assert.doesNotMatch(
      serialized,
      /Bearer secret/i,
    );

    assert.doesNotMatch(
      serialized,
      /proxy-user/i,
    );

    assert.doesNotMatch(
      serialized,
      /proxy-password/i,
    );

    assert.doesNotMatch(
      serialized,
      /proxy-one\.example/i,
    );

    assert.doesNotMatch(
      serialized,
      /203\.0\.113\.10/,
    );

    assert.doesNotMatch(
      serialized,
      /hash-secret/i,
    );

    assert.doesNotMatch(
      serialized,
      /idem-secret/i,
    );

    assert.doesNotMatch(
      serialized,
      /must-not-be-forwarded/i,
    );
  },
);


test(
  'manual challenge and final-result counters remain aggregate only',
  () => {
    const {
      service,
    } =
      createHarness();

    const snapshot =
      service.snapshot();

    assert.equal(
      snapshot.jobs
        .waitingForManualChallenge,
      1,
    );

    assert.equal(
      snapshot.throughput
        .manualChallenges,
      3,
    );

    assert.deepEqual(
      snapshot.manualResume,
      {
        total:
          4,

        completed:
          2,

        failed:
          1,

        manualChallenges:
          1,

        aborted:
          0,
      },
    );

    assert.deepEqual(
      snapshot.finalResults,
      {
        pending:
          1,

        inFlight:
          1,

        uncertain:
          1,

        delivered:
          2,
      },
    );
  },
);


test(
  'snapshot is deeply frozen',
  () => {
    const {
      service,
    } =
      createHarness();

    const snapshot =
      service.snapshot();

    assert.equal(
      Object.isFrozen(
        snapshot,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        snapshot.runtime,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        snapshot.jobs,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        snapshot.jobs.byState,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        snapshot.manualResume,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        snapshot.finalResults,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        snapshot.safety,
      ),
      true,
    );

    assert.throws(
      () => {
        snapshot.runtime.inFlight =
          99;
      },
      TypeError,
    );
  },
);


test(
  'malformed incomplete job provider fails closed',
  () => {
    const {
      service,
    } =
      createHarness({
        jobs:
          null,
      });

    assert.throws(
      () =>
        service.snapshot(),
      /jobStore\.listIncompleteJobs\(\) must be an array/,
    );
  },
);


test(
  'unsupported incomplete job state fails closed',
  () => {
    const {
      service,
    } =
      createHarness({
        jobs: [
          {
            id:
              'job-1',

            state:
              JOB_STATES.COMPLETED,
          },
        ],
      });

    assert.throws(
      () =>
        service.snapshot(),
      /unsupported observable state/,
    );
  },
);


test(
  'invalid runtime counters fail closed',
  () => {
    const invalidStatuses = [
      {
        inFlight:
          -1,

        memoryContexts:
          0,
      },

      {
        inFlight:
          0,

        memoryContexts:
          -1,
      },

      {
        inFlight:
          1.5,

        memoryContexts:
          0,
      },

      {
        inFlight:
          '1',

        memoryContexts:
          0,
      },

      {
        inFlight:
          0,

        memoryContexts:
          Number.MAX_SAFE_INTEGER
          + 1,
      },
    ];

    for (
      const executionStatus
      of invalidStatuses
    ) {
      const {
        service,
      } =
        createHarness({
          executionStatus,
        });

      assert.throws(
        () =>
          service.snapshot(),
        /non-negative safe integer/,
      );
    }
  },
);


test(
  'invalid intake execution status fails closed',
  () => {
    const {
      service,
    } =
      createHarness({
        handlerStatus: {
          stopped:
            false,

          handling:
            false,

          activeExecutions:
            0,

          activeJobs:
            0,

          completedCycles:
            0,

          totalAdmitted:
            0,

          totalWorkflowCompleted:
            0,

          totalFailed:
            0,

          totalManualChallenges:
            0,

          manualResume: {
            total:
              0,

            completed:
              0,

            failed:
              -1,

            manualChallenges:
              0,

            aborted:
              0,
          },
        },
      });

    assert.throws(
      () =>
        service.snapshot(),
      /manualResume\.failed must be a non-negative safe integer/,
    );
  },
);


test(
  'healthy proxy capacity cannot exceed configured proxy count',
  () => {
    const {
      service,
    } =
      createHarness({
        proxies: [
          {
            id:
              'proxy-1',
          },
        ],

        healthyAvailable:
          2,
      });

    assert.throws(
      () =>
        service.snapshot(),
      /cannot exceed total proxy count/,
    );
  },
);


test(
  'malformed final-result provider fails closed',
  () => {
    const {
      dependencies,
    } =
      createHarness();

    const finalResultStore = {
      listByDeliveryStatus(
        deliveryStatus,
      ) {
        if (
          deliveryStatus
          === FINAL_RESULT_DELIVERY_STATUSES
            .PENDING
        ) {
          return null;
        }

        return [];
      },
    };

    const service =
      new RuntimeObservability({
        jobStore:
          dependencies.jobStore,

        ipAllocator:
          dependencies.ipAllocator,

        proxyPool:
          dependencies.proxyPool,

        finalResultStore,

        executionWorker:
          dependencies.executionWorker,

        intakeExecutionHandler:
          dependencies
            .intakeExecutionHandler,

        clock:
          () =>
            new Date(
              '2026-09-23T02:00:00.000Z',
            ),
      });

    assert.throws(
      () =>
        service.snapshot(),
      /finalResultStore\.listByDeliveryStatus\(PENDING\) must be an array/,
    );
  },
);


test(
  'invalid observability clock fails closed',
  () => {
    const {
      service,
    } =
      createHarness({
        clock:
          () =>
            'not-a-date',
      });

    assert.throws(
      () =>
        service.snapshot(),
      /Observability clock must return a valid date/,
    );
  },
);


test(
  'constructor validates observability dependencies',
  () => {
    const {
      dependencies,
    } =
      createHarness();

    assert.throws(
      () =>
        new RuntimeObservability({
          jobStore: {},

          ipAllocator:
            dependencies.ipAllocator,

          proxyPool:
            dependencies.proxyPool,

          finalResultStore:
            dependencies.finalResultStore,

          executionWorker:
            dependencies.executionWorker,

          intakeExecutionHandler:
            dependencies
              .intakeExecutionHandler,
        }),
      /jobStore\.listIncompleteJobs must be a function/,
    );

    assert.throws(
      () =>
        new RuntimeObservability({
          jobStore:
            dependencies.jobStore,

          ipAllocator:
            dependencies.ipAllocator,

          proxyPool:
            dependencies.proxyPool,

          finalResultStore:
            dependencies.finalResultStore,

          executionWorker: {},

          intakeExecutionHandler:
            dependencies
              .intakeExecutionHandler,
        }),
      /executionWorker\.getStatus must be a function/,
    );

    assert.throws(
      () =>
        new RuntimeObservability({
          jobStore:
            dependencies.jobStore,

          ipAllocator:
            dependencies.ipAllocator,

          proxyPool:
            dependencies.proxyPool,

          finalResultStore:
            dependencies.finalResultStore,

          executionWorker:
            dependencies.executionWorker,

          intakeExecutionHandler:
            dependencies
              .intakeExecutionHandler,

          clock:
            null,
        }),
      /clock must be a function/,
    );
  },
);
