import test from "node:test";
import assert from "node:assert/strict";

import { OperationalService } from "../src/dashboard/operational-service.js";

function createFixture() {
  const jobs = [
    {
      id: "job-1",
      applicationId: "app-1",
      state: "RUNNING",
      currentStep: "slot.search",
      retryCount: 2,
      version: 7,
      createdAt: "2026-09-22T00:00:00.000Z",
      updatedAt: "2026-09-22T00:05:00.000Z",

      password: "must-not-leak",
      otp: "123456",
      Authorization: "Bearer secret",
      portalPayload: {
        applicant: "sensitive",
      },

      error: {
        code: "TEMP_FAILURE",
        message: "temporary failure",
        category: "NETWORK",
        retryable: true,

        password: "secret",
        responseBody: "sensitive",
      },
    },
    {
      id: "job-2",
      applicationId: "app-2",
      state: "WAITING_FOR_MANUAL_CHALLENGE",
      retryCount: 0,
      version: 2,
      createdAt: "2026-09-22T01:00:00.000Z",
      updatedAt: "2026-09-22T01:03:00.000Z",
    },
  ];

  const allocations = [
    {
      id: "allocation-1",
      jobId: "job-1",
      proxyId: "proxy-1",
      state: "ACTIVE",
      createdAt: "2026-09-22T00:01:00.000Z",
      updatedAt: "2026-09-22T00:04:00.000Z",

      proxyPassword: "must-not-leak",
      dispatcher: {
        secret: true,
      },
    },
  ];

  const proxies = [
    {
      id: "proxy-1",
      state: "ACTIVE",
      enabled: true,
      healthy: true,
      consecutiveFailures: 0,
      lastHealthCheckAt: "2026-09-22T00:04:00.000Z",

      host: "sensitive-host.example",
      username: "proxy-user",
      password: "proxy-password",
      url: "http://proxy-user:proxy-password@example",
    },
    {
      id: "proxy-2",
      state: "AVAILABLE",
      enabled: true,
      healthy: true,
      consecutiveFailures: 0,
      lastHealthCheckAt: "2026-09-22T00:04:30.000Z",
    },
  ];

  const finalResults = new Map([
    [
      "job-1",
      {
        jobId: "job-1",
        deliveryStatus: "PENDING",
        attemptCount: 1,
        updatedAt: "2026-09-22T00:05:00.000Z",

        payloadHash: "must-not-leak",
        payload: {
          secret: true,
        },
        idempotencyKey: "must-not-leak",
      },
    ],
  ]);

  const jobStore = {
    listIncompleteJobs() {
      return jobs;
    },

    getJobById(jobId) {
      return jobs.find((job) => job.id === jobId) ?? null;
    },
  };

  const ipAllocator = {
    getActiveForJob(jobId) {
      return (
        allocations.find(
          (allocation) => allocation.jobId === jobId,
        ) ?? null
      );
    },

    listLiveAllocations() {
      return allocations;
    },
  };

  const proxyPool = {
    listProxies() {
      return proxies;
    },

    countHealthyAvailable() {
      return 1;
    },
  };

  const finalResultStore = {
    getByJobId(jobId) {
      return finalResults.get(jobId) ?? null;
    },
  };

  return {
    service: new OperationalService({
      jobStore,
      ipAllocator,
      proxyPool,
      finalResultStore,
    }),
  };
}

test("overview returns safe aggregate operational state", () => {
  const { service } = createFixture();

  const overview = service.getOverview();

  assert.deepEqual(
    { ...overview.jobs.byState },
    {
      RUNNING: 1,
      WAITING_FOR_MANUAL_CHALLENGE: 1,
    },
  );

  assert.equal(overview.jobs.incomplete, 2);
  assert.equal(overview.jobs.manualChallenge, 1);

  assert.equal(overview.proxies.total, 2);
  assert.equal(
    overview.proxies.healthyAvailable,
    1,
  );

  assert.equal(overview.allocations.live, 1);
});

test("listJobs exposes allowlisted job fields only", () => {
  const { service } = createFixture();

  const jobs = service.listJobs();

  assert.equal(jobs.length, 2);

  const first = jobs[0];

  assert.deepEqual(first, {
    id: "job-1",
    applicationId: "app-1",
    state: "RUNNING",
    currentStep: "slot.search",
    retryCount: 2,
    version: 7,
    manualChallengeRequired: false,
    terminal: false,
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:05:00.000Z",
    error: {
      code: "TEMP_FAILURE",
      message: "temporary failure",
      category: "NETWORK",
      retryable: true,
    },
    allocation: {
      id: "allocation-1",
      jobId: "job-1",
      proxyId: "proxy-1",
      state: "ACTIVE",
      createdAt: "2026-09-22T00:01:00.000Z",
      updatedAt: "2026-09-22T00:04:00.000Z",
    },
    finalResult: {
      deliveryStatus: "PENDING",
      attemptCount: 1,
      deliveredAt: null,
      updatedAt: "2026-09-22T00:05:00.000Z",
    },
  });

  const serialized = JSON.stringify(first);

  assert.doesNotMatch(serialized, /must-not-leak/i);
  assert.doesNotMatch(serialized, /123456/);
  assert.doesNotMatch(serialized, /Bearer secret/i);
  assert.doesNotMatch(serialized, /proxy-password/i);
  assert.doesNotMatch(serialized, /payloadHash/i);
  assert.doesNotMatch(serialized, /idempotencyKey/i);
  assert.doesNotMatch(serialized, /portalPayload/i);
});

test("manual challenge state is surfaced explicitly", () => {
  const { service } = createFixture();

  const jobs = service.listJobs();

  const manualJob = jobs.find(
    (job) => job.id === "job-2",
  );

  assert.ok(manualJob);
  assert.equal(
    manualJob.manualChallengeRequired,
    true,
  );
  assert.equal(manualJob.terminal, false);
});

test("getJob returns null for unknown job", () => {
  const { service } = createFixture();

  assert.equal(
    service.getJob("missing-job"),
    null,
  );
});

test("getJob rejects empty job ID", () => {
  const { service } = createFixture();

  assert.throws(
    () => service.getJob(""),
    /jobId must be a non-empty string/,
  );
});

test("listProxies does not expose proxy credentials or connection details", () => {
  const { service } = createFixture();

  const proxies = service.listProxies();

  assert.equal(proxies.length, 2);

  assert.deepEqual(proxies[0], {
    id: "proxy-1",
    state: "ACTIVE",
    enabled: true,
    healthy: true,
    consecutiveFailures: 0,
    lastHealthCheckAt:
      "2026-09-22T00:04:00.000Z",
  });

  const serialized = JSON.stringify(proxies);

  assert.doesNotMatch(serialized, /proxy-user/i);
  assert.doesNotMatch(serialized, /proxy-password/i);
  assert.doesNotMatch(serialized, /sensitive-host/i);
});

test("listLiveAllocations does not expose dispatcher or proxy secrets", () => {
  const { service } = createFixture();

  const allocations =
    service.listLiveAllocations();

  assert.deepEqual(allocations, [
    {
      id: "allocation-1",
      jobId: "job-1",
      proxyId: "proxy-1",
      state: "ACTIVE",
      createdAt: "2026-09-22T00:01:00.000Z",
      updatedAt: "2026-09-22T00:04:00.000Z",
    },
  ]);

  const serialized = JSON.stringify(allocations);

  assert.doesNotMatch(serialized, /dispatcher/i);
  assert.doesNotMatch(serialized, /must-not-leak/i);
});

test("capacity reports healthy available count", () => {
  const { service } = createFixture();

  assert.deepEqual(
    service.getCapacity(),
    {
      healthyAvailable: 1,
      hasCapacity: true,
    },
  );
});

test("runtime status is fail-closed when provider is not configured", async () => {
  const { service } = createFixture();

  assert.deepEqual(
    await service.getRuntimeStatus(),
    {
      configured: false,
      status: null,
    },
  );
});

test("configured runtime status provider exposes bounded counters", async () => {
  const fixture = createFixture();

  const service = new OperationalService({
    jobStore: fixture.service.jobStore,
    ipAllocator: fixture.service.ipAllocator,
    proxyPool: fixture.service.proxyPool,
    finalResultStore:
      fixture.service.finalResultStore,
    runtimeStatusProvider: async () => ({
      inFlight: 2,
      memoryContexts: 3,
    }),
  });

  const runtimeStatus =
    await service.getRuntimeStatus();

  assert.equal(
    runtimeStatus.configured,
    true,
  );

  assert.deepEqual(
    { ...runtimeStatus.status },
    {
      inFlight: 2,
      memoryContexts: 3,
    },
  );
});

test("runtime status provider output is sanitized", async () => {
  const fixture = createFixture();

  const service = new OperationalService({
    jobStore: fixture.service.jobStore,
    ipAllocator: fixture.service.ipAllocator,
    proxyPool: fixture.service.proxyPool,
    finalResultStore:
      fixture.service.finalResultStore,
    runtimeStatusProvider: async () => ({
      inFlight: 1,
      memoryContexts: 2,
      token: "must-not-leak",
      cookie: "session-secret",
      otp: "123456",
      password: "password-secret",
    }),
  });

  const runtimeStatus =
    await service.getRuntimeStatus();

  assert.equal(
    runtimeStatus.configured,
    true,
  );

  assert.equal(
    runtimeStatus.status.inFlight,
    1,
  );

  assert.equal(
    runtimeStatus.status.memoryContexts,
    2,
  );

  const serialized =
    JSON.stringify(runtimeStatus);

  assert.doesNotMatch(serialized, /must-not-leak/i);
  assert.doesNotMatch(serialized, /session-secret/i);
  assert.doesNotMatch(serialized, /123456/);
  assert.doesNotMatch(serialized, /password-secret/i);
});

test("runtime status provider errors are safely projected", async () => {
  const fixture = createFixture();

  const service = new OperationalService({
    jobStore: fixture.service.jobStore,
    ipAllocator: fixture.service.ipAllocator,
    proxyPool: fixture.service.proxyPool,
    finalResultStore:
      fixture.service.finalResultStore,
    runtimeStatusProvider: async () => {
      const error = new Error(
        "runtime failed using Bearer secret-token",
      );

      error.code = "RUNTIME_STATUS_FAILED";
      error.password = "must-not-leak";

      throw error;
    },
  });

  const runtimeStatus =
    await service.getRuntimeStatus();

  assert.equal(
    runtimeStatus.configured,
    true,
  );

  assert.equal(
    runtimeStatus.status,
    null,
  );

  assert.equal(
    runtimeStatus.error.code,
    "RUNTIME_STATUS_FAILED",
  );

  assert.equal(
    runtimeStatus.error.message,
    "runtime failed using [REDACTED]",
  );

  assert.equal(
    Object.hasOwn(
      runtimeStatus.error,
      "password",
    ),
    false,
  );
});

test("runtimeStatusProvider constructor option is validated", () => {
  const fixture = createFixture();

  assert.throws(
    () =>
      new OperationalService({
        jobStore:
          fixture.service.jobStore,
        ipAllocator:
          fixture.service.ipAllocator,
        proxyPool:
          fixture.service.proxyPool,
        finalResultStore:
          fixture.service.finalResultStore,
        runtimeStatusProvider:
          "invalid",
      }),
    /runtimeStatusProvider must be a function or null/,
  );
});

test("readiness is fail-closed when provider is not configured", async () => {
  const { service } = createFixture();

  assert.deepEqual(
    await service.getReadiness(),
    {
      configured: false,
      ready: false,
      reason: "READINESS_PROVIDER_NOT_CONFIGURED",
    },
  );
});

test("configured readiness provider exposes only bounded safe fields", async () => {
  const fixture = createFixture();

  const service = new OperationalService({
    jobStore: fixture.service.jobStore,
    ipAllocator: fixture.service.ipAllocator,
    proxyPool: fixture.service.proxyPool,
    finalResultStore:
      fixture.service.finalResultStore,
    readinessProvider: async () => ({
      ready: true,
      reason: "READY",
      capacity: 3,
      checkedAt: "2026-09-22T02:00:00.000Z",

      Authorization: "Bearer secret",
      token: "secret",
      payload: {
        secret: true,
      },
    }),
  });

  const readiness =
    await service.getReadiness();

  assert.deepEqual(readiness, {
    configured: true,
    ready: true,
    reason: "READY",
    capacity: 3,
    checkedAt: "2026-09-22T02:00:00.000Z",
  });
});

test("readiness provider errors are safely projected", async () => {
  const fixture = createFixture();

  const service = new OperationalService({
    jobStore: fixture.service.jobStore,
    ipAllocator: fixture.service.ipAllocator,
    proxyPool: fixture.service.proxyPool,
    finalResultStore:
      fixture.service.finalResultStore,
    readinessProvider: async () => {
      const error = new Error(
        "failed using Bearer secret-token",
      );

      error.code = "HEALTH_CHECK_FAILED";
      error.password = "must-not-leak";

      throw error;
    },
  });

  const readiness =
    await service.getReadiness();

  assert.equal(readiness.configured, true);
  assert.equal(readiness.ready, false);
  assert.equal(
    readiness.reason,
    "READINESS_CHECK_FAILED",
  );

  assert.equal(
    readiness.error.code,
    "HEALTH_CHECK_FAILED",
  );

  assert.equal(
    readiness.error.message,
    "failed using [REDACTED]",
  );

  assert.equal(
    Object.hasOwn(
      readiness.error,
      "password",
    ),
    false,
  );
});