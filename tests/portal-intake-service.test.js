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
  JobStore,
} from '../src/jobs/job-store.js';

import {
  IpAllocator,
} from '../src/network/ip-allocator.js';

import {
  IntakeReservationStore,
} from '../src/network/intake-reservation-store.js';

import {
  ProxyPool,
} from '../src/network/proxy-pool.js';

import {
  PortalIntakeService,
} from '../src/portal/portal-intake-service.js';

import {
  PortalMapper,
} from '../src/portal/portal-mapper.js';

function createProxy(
  id,
  ip,
) {
  return {
    id,
    ip,
    port: 8080,
    protocol: 'http',
    enabled: true,
  };
}

function createFixture({
  proxies,
  pendingResponses,
  safeToConsume = true,
  configuredConcurrency = 10,
  jobsPerCycle = 10,
}) {
  const database =
    openDatabase({
      filePath: ':memory:',
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

  proxyPool.syncFromConfig(
    proxies,
  );

  for (
    const proxy
    of proxies
  ) {
    proxyPool.recordHealthSuccess(
      proxy.id,
      {
        latencyMs: 5,
      },
    );
  }

  const ipAllocator =
    new IpAllocator(
      database,
    );

  const intakeReservationStore =
    new IntakeReservationStore(
      database,
    );

  let pendingCalls = 0;

  const pendingCallArguments = [];

  const queue = [
    ...pendingResponses,
  ];

  const portalClient = {
    async healthCheck() {
      return {
        status:
          safeToConsume
            ? 'API_AUTHENTICATED'
            : 'AUTH_FAILED',

        reachable:
          safeToConsume,

        authenticated:
          safeToConsume,

        safeToConsume,
      };
    },

    async fetchPendingOne(
      ...args
    ) {
      pendingCalls += 1;

      pendingCallArguments.push(
        args,
      );

      return (
        queue.shift()
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

  const service =
    new PortalIntakeService({
      portalClient,
      portalMapper,
      jobStore,
      proxyPool,
      ipAllocator,
      intakeReservationStore,
      configuredConcurrency,
      jobsPerCycle,
    });

  return {
    database,
    jobStore,
    proxyPool,
    ipAllocator,
    intakeReservationStore,
    service,

    getPendingCalls() {
      return pendingCalls;
    },

    getPendingCallArguments() {
      return pendingCallArguments
        .map(
          (args) => [
            ...args,
          ],
        );
    },
  };
}

test(
  'TEST J: capacity is calculated before destructive Portal consumption',
  async () => {
    const fixture =
      createFixture({
        proxies: [
          createProxy(
            'proxy-1',
            '203.0.113.111',
          ),
        ],

        pendingResponses: [
          {
            id:
              'app-1',

            user_id:
              'user-1',

            documents: [],
          },
          {
            id:
              'app-2',

            user_id:
              'user-2',

            documents: [],
          },
        ],

        configuredConcurrency:
          5,

        jobsPerCycle:
          5,
      });

    try {
      const result =
        await fixture.service
          .runCycle();

      assert.equal(
        result.effectiveCapacity,
        1,
      );

      assert.equal(
        result.created,
        1,
      );

      assert.equal(
        fixture.getPendingCalls(),
        1,
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
  'Portal intake keeps the reserved execution IP separate from static Portal worker identity',
  async () => {
    const fixture =
      createFixture({
        proxies: [
          createProxy(
            'proxy-worker',
            '203.0.113.121',
          ),
        ],

        pendingResponses: [
          {
            id:
              'app-worker',

            user_id:
              'user-worker',

            documents: [],
          },
        ],
      });

    try {
      const result =
        await fixture.service
          .runCycle();

      assert.equal(
        result.created,
        1,
      );

      /*
       * PortalIntakeService must not pass the allocated proxy IP
       * as Server-Name.
       *
       * Static Portal worker identity belongs to PortalClient
       * configuration.
       */
      assert.deepEqual(
        fixture
          .getPendingCallArguments(),
        [
          [],
        ],
      );

      /*
       * The reserved proxy IP still remains exclusively bound to
       * the created job.
       */
      assert.equal(
        result.jobs[0]
          .assignedIp,
        '203.0.113.121',
      );

      const allocation =
        fixture.ipAllocator
          .getActiveForJob(
            result.jobs[0]
              .jobId,
          );

      assert.equal(
        allocation.ip,
        '203.0.113.121',
      );

      assert.equal(
        allocation.jobId,
        result.jobs[0]
          .jobId,
      );
    } finally {
      closeDatabase(
        fixture.database,
      );
    }
  },
);

test(
  'TEST I: duplicate Portal application does not create a second execution',
  async () => {
    const fixture =
      createFixture({
        proxies: [
          createProxy(
            'proxy-duplicate',
            '203.0.113.131',
          ),
        ],

        pendingResponses: [
          {
            id:
              'app-duplicate',

            user_id:
              'user-1',

            documents: [],
          },
        ],
      });

    try {
      fixture.jobStore
        .createOrGetJob({
          applicationId:
            'app-duplicate',

          userId:
            'user-1',
        });

      const result =
        await fixture.service
          .runCycle();

      assert.equal(
        result.consumed,
        1,
      );

      assert.equal(
        result.created,
        0,
      );

      assert.equal(
        result.duplicates,
        1,
      );

      assert.equal(
        fixture.ipAllocator
          .listLiveAllocations()
          .length,
        0,
      );

      assert.equal(
        fixture.intakeReservationStore
          .countReserved(),
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
  'unhealthy Portal readiness prevents every pending request',
  async () => {
    const fixture =
      createFixture({
        proxies: [
          createProxy(
            'proxy-blocked',
            '203.0.113.141',
          ),
        ],

        pendingResponses: [
          {
            id:
              'must-not-consume',

            documents: [],
          },
        ],

        safeToConsume:
          false,
      });

    try {
      const result =
        await fixture.service
          .runCycle();

      assert.equal(
        result.created,
        0,
      );

      assert.equal(
        result.blocker,
        'AUTH_FAILED',
      );

      assert.equal(
        fixture.getPendingCalls(),
        0,
      );

      assert.equal(
        fixture.intakeReservationStore
          .countReserved(),
        0,
      );
    } finally {
      closeDatabase(
        fixture.database,
      );
    }
  },
);