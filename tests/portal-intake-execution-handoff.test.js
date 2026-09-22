import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PortalIntakeService,
} from '../src/portal/portal-intake-service.js';

function createService() {
  let reservationUsed =
    false;

  const normalizedApplication = {
    applicationId:
      'application-1',

    userId:
      'user-1',

    phone:
      '01700000000',

    password:
      'super-secret-password',

    passportNumber:
      'A1234567',

    documents: [
      {
        url:
          'https://portal.example/document.pdf',

        name:
          'document.pdf',
      },
    ],
  };

  const portalClient = {
    async healthCheck() {
      return {
        status:
          'READY',

        reachable:
          true,

        authenticated:
          true,

        safeToConsume:
          true,
      };
    },

    async fetchPendingOne({
      serverName,
    }) {
      assert.equal(
        serverName,
        '192.0.2.10',
      );

      return {
        raw:
          'portal-payload',
      };
    },
  };

  const portalMapper = {
    normalizeApplication() {
      return structuredClone(
        normalizedApplication,
      );
    },
  };

  const jobStore = {
    createOrGetJob({
      applicationId,
      userId,
    }) {
      assert.equal(
        applicationId,
        'application-1',
      );

      assert.equal(
        userId,
        'user-1',
      );

      return {
        created:
          true,

        job: {
          id:
            'job-1',

          applicationId:
            'application-1',

          userId:
            'user-1',

          state:
            'PENDING',
        },
      };
    },

    transitionJob(
      jobId,
      state,
    ) {
      assert.equal(
        jobId,
        'job-1',
      );

      return {
        id:
          'job-1',

        applicationId:
          'application-1',

        userId:
          'user-1',

        state,
      };
    },
  };

  const proxyPool = {
    countHealthyAvailable() {
      return 1;
    },
  };

  const ipAllocator = {
    listLiveAllocations() {
      return [];
    },
  };

  const intakeReservationStore = {
    reserveOne({
      maxConcurrent,
    }) {
      assert.equal(
        maxConcurrent,
        1,
      );

      if (reservationUsed) {
        return null;
      }

      reservationUsed =
        true;

      return {
        reservationId:
          'reservation-1',

        proxyId:
          'proxy-1',

        ip:
          '192.0.2.10',

        port:
          8080,
      };
    },

    bindToJob(
      reservationId,
      {
        jobId,
        userId,
      },
    ) {
      assert.equal(
        reservationId,
        'reservation-1',
      );

      assert.equal(
        jobId,
        'job-1',
      );

      assert.equal(
        userId,
        'user-1',
      );

      return {
        allocationId:
          'allocation-1',

        jobId:
          'job-1',

        userId:
          'user-1',

        proxyId:
          'proxy-1',

        ip:
          '192.0.2.10',

        port:
          8080,

        status:
          'RESERVED',
      };
    },

    release() {
      throw new Error(
        'Reservation should not be released on successful intake.',
      );
    },
  };

  return new PortalIntakeService({
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
}

test(
  'fresh intake exposes execution input only as a non-enumerable memory handoff',
  async () => {
    const service =
      createService();

    const result =
      await service.runCycle();

    assert.equal(
      result.created,
      1,
    );

    assert.equal(
      result.jobs.length,
      1,
    );

    const job =
      result.jobs[0];

    assert.equal(
      job.jobId,
      'job-1',
    );

    assert.equal(
      job.allocationId,
      'allocation-1',
    );

    assert.equal(
      job.assignedIp,
      '192.0.2.10',
    );

    assert.ok(
      job.executionInput,
    );

    assert.equal(
      job.executionInput
        .applicationId,
      'application-1',
    );

    assert.equal(
      job.executionInput
        .userId,
      'user-1',
    );

    assert.equal(
      job.executionInput
        .phone,
      '01700000000',
    );

    assert.equal(
      job.executionInput
        .password,
      'super-secret-password',
    );

    assert.equal(
      job.executionInput
        .passportNumber,
      'A1234567',
    );

    assert.deepEqual(
      job.executionInput
        .documents,
      [
        {
          url:
            'https://portal.example/document.pdf',

          name:
            'document.pdf',
        },
      ],
    );

    const descriptor =
      Object.getOwnPropertyDescriptor(
        job,
        'executionInput',
      );

    assert.ok(
      descriptor,
    );

    assert.equal(
      descriptor.enumerable,
      false,
    );

    assert.equal(
      descriptor.writable,
      false,
    );

    assert.equal(
      descriptor.configurable,
      false,
    );

    assert.equal(
      Object.isFrozen(
        job.executionInput,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        job.executionInput
          .documents,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        job.executionInput
          .documents[0],
      ),
      true,
    );
  },
);

test(
  'JSON serialization omits sensitive execution input',
  async () => {
    const service =
      createService();

    const result =
      await service.runCycle();

    const job =
      result.jobs[0];

    const serialized =
      JSON.stringify(
        job,
      );

    assert.match(
      serialized,
      /"jobId":"job-1"/,
    );

    assert.match(
      serialized,
      /"allocationId":"allocation-1"/,
    );

    assert.equal(
      serialized.includes(
        'executionInput',
      ),
      false,
    );

    assert.equal(
      serialized.includes(
        'super-secret-password',
      ),
      false,
    );

    assert.equal(
      serialized.includes(
        '01700000000',
      ),
      false,
    );

    assert.equal(
      serialized.includes(
        'A1234567',
      ),
      false,
    );

    assert.equal(
      serialized.includes(
        'document.pdf',
      ),
      false,
    );

    assert.equal(
      serialized.includes(
        'https://portal.example/document.pdf',
      ),
      false,
    );
  },
);

test(
  'enumerating the public job descriptor does not expose execution input',
  async () => {
    const service =
      createService();

    const result =
      await service.runCycle();

    const job =
      result.jobs[0];

    assert.deepEqual(
      Object.keys(job),
      [
        'jobId',
        'applicationId',
        'state',
        'allocationId',
        'assignedIp',
        'port',
      ],
    );

    assert.equal(
      Object.prototype
        .propertyIsEnumerable
        .call(
          job,
          'executionInput',
        ),
      false,
    );
  },
);

test(
  'execution input is intentionally lost across a serialized restart boundary',
  async () => {
    const service =
      createService();

    const result =
      await service.runCycle();

    const liveJob =
      result.jobs[0];

    assert.equal(
      liveJob.executionInput
        .password,
      'super-secret-password',
    );

    /*
     * This models the durable/public representation that could
     * survive a process boundary.
     *
     * executionInput is intentionally non-enumerable, so the
     * reconstructed object cannot claim that Portal credentials,
     * OTP-related input, or document source data survived a
     * restart.
     */
    const durableRepresentation =
      JSON.stringify(
        liveJob,
      );

    const afterRestart =
      JSON.parse(
        durableRepresentation,
      );

    assert.equal(
      afterRestart.jobId,
      'job-1',
    );

    assert.equal(
      afterRestart.allocationId,
      'allocation-1',
    );

    assert.equal(
      Object.prototype
        .hasOwnProperty
        .call(
          afterRestart,
          'executionInput',
        ),
      false,
    );

    assert.equal(
      afterRestart.executionInput,
      undefined,
    );

    assert.equal(
      durableRepresentation.includes(
        'super-secret-password',
      ),
      false,
    );

    assert.equal(
      durableRepresentation.includes(
        '01700000000',
      ),
      false,
    );

    assert.equal(
      durableRepresentation.includes(
        'A1234567',
      ),
      false,
    );

    assert.equal(
      durableRepresentation.includes(
        'document.pdf',
      ),
      false,
    );
  },
);