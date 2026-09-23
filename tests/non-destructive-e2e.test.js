import assert from 'node:assert/strict';
import test from 'node:test';

import {
  closeDatabase,
  openDatabase,
} from '../src/db/database.js';

import {
  migrateDatabase,
} from '../src/db/migrations.js';

import {
  JOB_STATES,
} from '../src/jobs/job-state.js';

import {
  JobStore,
} from '../src/jobs/job-store.js';

import {
  IntakeReservationStore,
} from '../src/network/intake-reservation-store.js';

import {
  IpAllocator,
} from '../src/network/ip-allocator.js';

import {
  ProxyPool,
} from '../src/network/proxy-pool.js';

import {
  PortalIntakeService,
} from '../src/portal/portal-intake-service.js';

import {
  PortalMapper,
} from '../src/portal/portal-mapper.js';

import {
  FinalResultService,
} from '../src/results/final-result-service.js';

import {
  FINAL_RESULT_DELIVERY_STATUSES,
  FinalResultStore,
} from '../src/results/final-result-store.js';

import {
  ExecutionWorker,
} from '../src/runtime/execution-worker.js';

import {
  FinalizingExecutionRunner,
} from '../src/runtime/finalizing-execution-runner.js';

import {
  IntakeExecutionHandler,
} from '../src/runtime/intake-execution-handler.js';

import {
  RetryingExecutionRunner,
} from '../src/runtime/retrying-execution-runner.js';


function createProxy() {
  return {
    id:
      'proxy-e2e-1',

    ip:
      '203.0.113.50',

    port:
      8080,

    protocol:
      'http',

    enabled:
      true,
  };
}


function createPortalApplication({
  id = '1001',
} = {}) {
  return {
    id,

    user_id:
      'user-e2e-1',

    phone:
      '01700000000',

    password:
      'must-remain-memory-only',

    passport_number:
      'A1234567',

    documents: [],
  };
}


function createCookieJar() {
  return {
    getCookieHeader() {
      return null;
    },

    setCookies() {},

    clear() {},
  };
}


function createFixture({
  pendingResponses = [
    createPortalApplication(),
  ],

  workflowImplementation =
    async ({
      jobContext,
    }) => {
      assert.equal(
        jobContext.input.phone,
        '01700000000',
      );

      assert.equal(
        jobContext.input.password,
        'must-remain-memory-only',
      );

      assert.equal(
        jobContext.input.passportNumber,
        'A1234567',
      );

      assert.equal(
        jobContext.allocation.ip,
        '203.0.113.50',
      );

      return {
        status:
          'COMPLETED',

        workflowName:
          'non-destructive-e2e',

        completedSteps:
          4,
      };
    },
} = {}) {
  const database =
    openDatabase({
      filePath:
        ':memory:',
    });

  migrateDatabase(
    database,
  );

  const jobStore =
    new JobStore(
      database,
    );

  const proxyPool =
    new ProxyPool(
      database,
    );

  const proxy =
    createProxy();

  proxyPool.syncFromConfig([
    proxy,
  ]);

  proxyPool.recordHealthSuccess(
    proxy.id,
    {
      latencyMs:
        5,
    },
  );

  const ipAllocator =
    new IpAllocator(
      database,
    );

  const intakeReservationStore =
    new IntakeReservationStore(
      database,
    );

  const finalResultStore =
    new FinalResultStore(
      database,
    );

  const pendingQueue = [
    ...pendingResponses,
  ];

  let healthCalls =
    0;

  let pendingCalls =
    0;

  let resultSendCalls =
    0;

  const deliveredResults =
    [];

  const portalClient = {
    async healthCheck() {
      healthCalls +=
        1;

      return {
        status:
          'API_AUTHENTICATED',

        reachable:
          true,

        authenticated:
          true,

        safeToConsume:
          true,
      };
    },

    async fetchPendingOne() {
      pendingCalls +=
        1;

      return (
        pendingQueue.shift()
        ?? null
      );
    },
  };

  const portalMapper =
    new PortalMapper({
      applicationId:
        'id',

      userId:
        'user_id',

      phone:
        'phone',

      password:
        'password',

      passportNumber:
        'passport_number',

      documents:
        'documents',
    });

  const portalIntakeService =
    new PortalIntakeService({
      portalClient,
      portalMapper,
      jobStore,
      proxyPool,
      ipAllocator,
      intakeReservationStore,

      configuredConcurrency:
        1,

      jobsPerCycle:
        1,
    });

  const sessions =
    new Map();

  const sessionManager = {
    async createForJob({
      job,
      allocation,
    }) {
      const existing =
        sessions.get(
          job.id,
        );

      if (existing) {
        return existing;
      }

      const session = {
        sessionId:
          `session-${job.id}`,

        jobId:
          job.id,

        allocationId:
          allocation.allocationId,

        proxyId:
          allocation.proxyId,

        assignedIp:
          allocation.ip,

        port:
          allocation.port,

        dispatcher: {},

        cookieJar:
          createCookieJar(),

        closed:
          false,
      };

      sessions.set(
        job.id,
        session,
      );

      return session;
    },

    async closeForJob(
      jobId,
    ) {
      const session =
        sessions.get(
          jobId,
        );

      if (!session) {
        return false;
      }

      session.closed =
        true;

      sessions.delete(
        jobId,
      );

      return true;
    },
  };

  const executionWorker =
    new ExecutionWorker({
      jobStore,
      ipAllocator,
      sessionManager,

      executeWorkflow:
        workflowImplementation,
    });

  const retryingExecutionRunner =
    new RetryingExecutionRunner({
      executionWorker,
      jobStore,
      ipAllocator,

      maxRetries:
        1,

      sleepFn:
        async () => {},
    });

  const portalResultClient = {
    isConfigured() {
      return true;
    },

    supportsIdempotentReplay() {
      return false;
    },

    async sendResult({
      record,
      job,
      allocation,
    }) {
      resultSendCalls +=
        1;

      deliveredResults.push(
        structuredClone({
          record,
          job,
          allocation,
        }),
      );

      return {
        statusCode:
          200,
      };
    },
  };

  const finalResultService =
    new FinalResultService({
      jobStore,
      finalResultStore,
      portalResultClient,
      ipAllocator,
    });

  const finalizingExecutionRunner =
    new FinalizingExecutionRunner({
      executionWorker:
        retryingExecutionRunner,

      finalResultService,
    });

  const intakeExecutionHandler =
    new IntakeExecutionHandler({
      executionWorker:
        finalizingExecutionRunner,
    });

  return {
    database,
    jobStore,
    proxyPool,
    ipAllocator,
    finalResultStore,
    portalIntakeService,
    intakeExecutionHandler,

    getHealthCalls() {
      return healthCalls;
    },

    getPendingCalls() {
      return pendingCalls;
    },

    getResultSendCalls() {
      return resultSendCalls;
    },

    getDeliveredResults() {
      return structuredClone(
        deliveredResults,
      );
    },
  };
}


test(
  'Phase 34 non-destructive E2E completes intake through durable finalization without real network',
  async () => {
    const fixture =
      createFixture();

    try {
      const cycle =
        await fixture
          .portalIntakeService
          .runCycle();

      assert.equal(
        cycle.consumed,
        1,
      );

      assert.equal(
        cycle.created,
        1,
      );

      assert.equal(
        cycle.duplicates,
        0,
      );

      assert.equal(
        cycle.jobs.length,
        1,
      );

      assert.equal(
        fixture.getHealthCalls(),
        1,
      );

      assert.equal(
        fixture.getPendingCalls(),
        1,
      );

      const handoff =
        cycle.jobs[0];

      assert.equal(
        Object.prototype
          .propertyIsEnumerable
          .call(
            handoff,
            'executionInput',
          ),
        false,
      );

      assert.equal(
        JSON.stringify(
          handoff,
        ).includes(
          'must-remain-memory-only',
        ),
        false,
      );

      assert.equal(
        handoff.executionInput
          .password,
        'must-remain-memory-only',
      );

      const allocationBeforeExecution =
        fixture.ipAllocator
          .getActiveForJob(
            handoff.jobId,
          );

      assert.ok(
        allocationBeforeExecution,
      );

      assert.equal(
        allocationBeforeExecution.ip,
        '203.0.113.50',
      );

      assert.equal(
        allocationBeforeExecution.status,
        'RESERVED',
      );

      const summary =
        await fixture
          .intakeExecutionHandler
          .handleCycleResult(
            cycle,
          );

      assert.deepEqual(
        summary,
        {
          admitted:
            1,

          workflowCompleted:
            1,

          failed:
            0,

          manualChallenges:
            0,

          aborted:
            0,

          skippedAfterStop:
            0,
        },
      );

      const finalJob =
        fixture.jobStore
          .getJobById(
            handoff.jobId,
          );

      assert.ok(
        finalJob,
      );

      assert.equal(
        finalJob.state,
        JOB_STATES.COMPLETED,
      );

      assert.equal(
        finalJob.retryCount,
        0,
      );

      const durableResult =
        fixture.finalResultStore
          .getByJobId(
            handoff.jobId,
          );

      assert.ok(
        durableResult,
      );

      assert.equal(
        durableResult.outcome,
        'SUCCESS',
      );

      assert.equal(
        durableResult.terminalState,
        JOB_STATES.COMPLETED,
      );

      assert.equal(
        durableResult.deliveryStatus,
        FINAL_RESULT_DELIVERY_STATUSES
          .DELIVERED,
      );

      assert.deepEqual(
        durableResult.data,
        {
          workflowName:
            'non-destructive-e2e',

          completedSteps:
            4,
        },
      );

      assert.equal(
        fixture.getResultSendCalls(),
        1,
      );

      const delivered =
        fixture.getDeliveredResults();

      assert.equal(
        delivered.length,
        1,
      );

      assert.equal(
        delivered[0]
          .allocation
          .allocationId,
        allocationBeforeExecution
          .allocationId,
      );

      assert.equal(
        delivered[0]
          .allocation
          .ip,
        allocationBeforeExecution
          .ip,
      );

      const serializedDelivery =
        JSON.stringify(
          delivered[0],
        );

      assert.equal(
        serializedDelivery.includes(
          'must-remain-memory-only',
        ),
        false,
      );

      assert.equal(
        serializedDelivery.includes(
          '01700000000',
        ),
        false,
      );

      assert.equal(
        serializedDelivery.includes(
          'A1234567',
        ),
        false,
      );

      assert.equal(
        fixture.ipAllocator
          .getActiveForJob(
            handoff.jobId,
          ),
        null,
      );

      assert.equal(
        fixture.ipAllocator
          .listLiveAllocations()
          .length,
        0,
      );

      assert.equal(
        fixture.proxyPool
          .countHealthyAvailable(),
        1,
      );
    } finally {
      closeDatabase(
        fixture.database,
      );
    }
  },
);


test(
  'Phase 34 manual challenge E2E remains non-terminal and preserves the same live IP',
  async () => {
    let workflowCalls =
      0;

    const fixture =
      createFixture({
        workflowImplementation:
          async ({
            jobContext,
          }) => {
            workflowCalls +=
              1;

            jobContext.setCurrentStep(
              'verify_signin_otp',
            );

            const error =
              new Error(
                'Synthetic manual challenge.',
              );

            error.code =
              'MANUAL_CHALLENGE_REQUIRED';

            throw error;
          },
      });

    try {
      const cycle =
        await fixture
          .portalIntakeService
          .runCycle();

      assert.equal(
        cycle.created,
        1,
      );

      const handoff =
        cycle.jobs[0];

      const allocationBefore =
        fixture.ipAllocator
          .getActiveForJob(
            handoff.jobId,
          );

      assert.ok(
        allocationBefore,
      );

      const summary =
        await fixture
          .intakeExecutionHandler
          .handleCycleResult(
            cycle,
          );

      assert.equal(
        workflowCalls,
        1,
      );

      assert.equal(
        summary.admitted,
        1,
      );

      assert.equal(
        summary.workflowCompleted,
        0,
      );

      assert.equal(
        summary.failed,
        0,
      );

      assert.equal(
        summary.manualChallenges,
        1,
      );

      assert.equal(
        summary.aborted,
        0,
      );

      const waitingJob =
        fixture.jobStore
          .getJobById(
            handoff.jobId,
          );

      assert.equal(
        waitingJob.state,
        JOB_STATES
          .WAITING_FOR_MANUAL_CHALLENGE,
      );

      assert.equal(
        waitingJob.currentStep,
        'verify_signin_otp',
      );

      assert.equal(
        waitingJob.failureCode,
        'MANUAL_CHALLENGE_REQUIRED',
      );

      assert.equal(
        fixture.getResultSendCalls(),
        0,
      );

      assert.equal(
        fixture.finalResultStore
          .getByJobId(
            handoff.jobId,
          ),
        null,
      );

      const allocationAfter =
        fixture.ipAllocator
          .getActiveForJob(
            handoff.jobId,
          );

      assert.ok(
        allocationAfter,
      );

      assert.equal(
        allocationAfter
          .allocationId,
        allocationBefore
          .allocationId,
      );

      assert.equal(
        allocationAfter.ip,
        allocationBefore.ip,
      );

      assert.equal(
        allocationAfter.status,
        'ACTIVE',
      );

      assert.equal(
        fixture.ipAllocator
          .listLiveAllocations()
          .length,
        1,
      );
    } finally {
      closeDatabase(
        fixture.database,
      );
    }
  },
);


test(
  'Phase 34 duplicate Portal application is not executed or finalized twice',
  async () => {
    const application =
      createPortalApplication({
        id:
          '2002',
      });

    let workflowCalls =
      0;

    const fixture =
      createFixture({
        pendingResponses: [
          application,
          structuredClone(
            application,
          ),
        ],

        workflowImplementation:
          async () => {
            workflowCalls +=
              1;

            return {
              status:
                'COMPLETED',

              workflowName:
                'duplicate-e2e',

              completedSteps:
                1,
            };
          },
      });

    try {
      const firstCycle =
        await fixture
          .portalIntakeService
          .runCycle();

      assert.equal(
        firstCycle.created,
        1,
      );

      const firstSummary =
        await fixture
          .intakeExecutionHandler
          .handleCycleResult(
            firstCycle,
          );

      assert.equal(
        firstSummary.workflowCompleted,
        1,
      );

      assert.equal(
        workflowCalls,
        1,
      );

      assert.equal(
        fixture.getResultSendCalls(),
        1,
      );

      const secondCycle =
        await fixture
          .portalIntakeService
          .runCycle();

      assert.equal(
        secondCycle.consumed,
        1,
      );

      assert.equal(
        secondCycle.created,
        0,
      );

      assert.equal(
        secondCycle.duplicates,
        1,
      );

      assert.equal(
        secondCycle.jobs.length,
        0,
      );

      const secondSummary =
        await fixture
          .intakeExecutionHandler
          .handleCycleResult(
            secondCycle,
          );

      assert.equal(
        secondSummary.admitted,
        0,
      );

      assert.equal(
        secondSummary.workflowCompleted,
        0,
      );

      assert.equal(
        workflowCalls,
        1,
      );

      assert.equal(
        fixture.getResultSendCalls(),
        1,
      );
    } finally {
      closeDatabase(
        fixture.database,
      );
    }
  },
);