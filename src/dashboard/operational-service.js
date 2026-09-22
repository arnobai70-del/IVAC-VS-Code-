import {
  sanitizeOperationalError,
  sanitizeOperationalValue,
} from "./redaction.js";

const TERMINAL_JOB_STATES = new Set([
  "COMPLETED",
  "FAILED_FINAL",
  "CANCELLED",
]);

const MANUAL_CHALLENGE_STATE = "WAITING_FOR_MANUAL_CHALLENGE";

function isObject(value) {
  return value !== null && typeof value === "object";
}

function firstDefined(object, keys) {
  if (!isObject(object)) {
    return undefined;
  }

  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null) {
      return object[key];
    }
  }

  return undefined;
}

function asSafeString(value) {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  return null;
}

function asSafeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function asSafeCount(value) {
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return value;
  }

  return null;
}

function asSafeBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function asSafeTimestamp(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string" || typeof value === "number") {
    return sanitizeOperationalValue(value);
  }

  return null;
}

function extractJobId(record) {
  return asSafeString(
    firstDefined(record, [
      "jobId",
      "job_id",
      "id",
    ]),
  );
}

function extractApplicationId(record) {
  return asSafeString(
    firstDefined(record, [
      "applicationId",
      "application_id",
      "portalApplicationId",
      "portal_application_id",
    ]),
  );
}

function extractJobState(record) {
  return asSafeString(
    firstDefined(record, [
      "state",
      "jobState",
      "job_state",
      "status",
    ]),
  );
}

function extractCurrentStep(record) {
  return asSafeString(
    firstDefined(record, [
      "currentStep",
      "current_step",
      "workflowStep",
      "workflow_step",
      "step",
    ]),
  );
}

function extractRetryCount(record) {
  return (
    asSafeNumber(
      firstDefined(record, [
        "retryCount",
        "retry_count",
        "retries",
      ]),
    ) ?? 0
  );
}

function extractVersion(record) {
  return asSafeNumber(
    firstDefined(record, [
      "version",
      "rowVersion",
      "row_version",
    ]),
  );
}

function extractCreatedAt(record) {
  return asSafeTimestamp(
    firstDefined(record, [
      "createdAt",
      "created_at",
    ]),
  );
}

function extractUpdatedAt(record) {
  return asSafeTimestamp(
    firstDefined(record, [
      "updatedAt",
      "updated_at",
    ]),
  );
}

function extractLastError(record) {
  if (!isObject(record)) {
    return null;
  }

  const directError = firstDefined(record, [
    "lastError",
    "last_error",
    "error",
  ]);

  if (directError instanceof Error) {
    return {
      ...sanitizeOperationalError(directError),
    };
  }

  if (isObject(directError)) {
    return {
      ...sanitizeOperationalValue({
        name: firstDefined(directError, ["name"]),
        code: firstDefined(directError, ["code"]),
        message: firstDefined(directError, ["message"]),
        category: firstDefined(directError, ["category"]),
        retryable: firstDefined(directError, ["retryable"]),
        statusCode: firstDefined(directError, [
          "statusCode",
          "status_code",
        ]),
      }),
    };
  }

  const code = firstDefined(record, [
    "errorCode",
    "error_code",
    "lastErrorCode",
    "last_error_code",
  ]);

  const message = firstDefined(record, [
    "errorMessage",
    "error_message",
    "lastErrorMessage",
    "last_error_message",
  ]);

  const category = firstDefined(record, [
    "errorCategory",
    "error_category",
  ]);

  const retryable = firstDefined(record, [
    "errorRetryable",
    "error_retryable",
  ]);

  if (
    code === undefined &&
    message === undefined &&
    category === undefined &&
    retryable === undefined
  ) {
    return null;
  }

  return {
    ...sanitizeOperationalValue({
      code,
      message,
      category,
      retryable,
    }),
  };
}

function projectJob(record) {
  const state = extractJobState(record);

  return {
    id: extractJobId(record),
    applicationId: extractApplicationId(record),
    state,
    currentStep: extractCurrentStep(record),
    retryCount: extractRetryCount(record),
    version: extractVersion(record),
    manualChallengeRequired:
      state === MANUAL_CHALLENGE_STATE,
    terminal:
      typeof state === "string"
        ? TERMINAL_JOB_STATES.has(state)
        : false,
    createdAt: extractCreatedAt(record),
    updatedAt: extractUpdatedAt(record),
    error: extractLastError(record),
  };
}

function extractProxyId(record) {
  return asSafeString(
    firstDefined(record, [
      "proxyId",
      "proxy_id",
      "id",
    ]),
  );
}

function extractProxyState(record) {
  return asSafeString(
    firstDefined(record, [
      "state",
      "proxyState",
      "proxy_state",
      "status",
    ]),
  );
}

function projectProxy(record) {
  return {
    id: extractProxyId(record),
    state: extractProxyState(record),
    enabled: asSafeBoolean(
      firstDefined(record, [
        "enabled",
        "isEnabled",
        "is_enabled",
      ]),
    ),
    healthy: asSafeBoolean(
      firstDefined(record, [
        "healthy",
        "isHealthy",
        "is_healthy",
      ]),
    ),
    consecutiveFailures: asSafeNumber(
      firstDefined(record, [
        "consecutiveFailures",
        "consecutive_failures",
        "failureCount",
        "failure_count",
      ]),
    ),
    lastHealthCheckAt: asSafeTimestamp(
      firstDefined(record, [
        "lastHealthCheckAt",
        "last_health_check_at",
        "healthCheckedAt",
        "health_checked_at",
      ]),
    ),
  };
}

function projectAllocation(record) {
  return {
    id: asSafeString(
      firstDefined(record, [
        "allocationId",
        "allocation_id",
        "id",
      ]),
    ),
    jobId: asSafeString(
      firstDefined(record, [
        "jobId",
        "job_id",
      ]),
    ),
    proxyId: asSafeString(
      firstDefined(record, [
        "proxyId",
        "proxy_id",
      ]),
    ),
    state: asSafeString(
      firstDefined(record, [
        "state",
        "allocationState",
        "allocation_state",
        "status",
      ]),
    ),
    createdAt: asSafeTimestamp(
      firstDefined(record, [
        "createdAt",
        "created_at",
      ]),
    ),
    updatedAt: asSafeTimestamp(
      firstDefined(record, [
        "updatedAt",
        "updated_at",
      ]),
    ),
  };
}

function projectFinalResult(record) {
  if (!record) {
    return null;
  }

  return {
    deliveryStatus: asSafeString(
      firstDefined(record, [
        "deliveryStatus",
        "delivery_status",
        "status",
      ]),
    ),
    attemptCount: asSafeNumber(
      firstDefined(record, [
        "attemptCount",
        "attempt_count",
        "deliveryAttempts",
        "delivery_attempts",
      ]),
    ),
    deliveredAt: asSafeTimestamp(
      firstDefined(record, [
        "deliveredAt",
        "delivered_at",
      ]),
    ),
    updatedAt: asSafeTimestamp(
      firstDefined(record, [
        "updatedAt",
        "updated_at",
      ]),
    ),
  };
}

function projectRuntimeStatus(record) {
  if (!isObject(record)) {
    return null;
  }

  const inFlight =
    asSafeCount(
      firstDefined(record, [
        "inFlight",
        "in_flight",
      ]),
    );

  const memoryContexts =
    asSafeCount(
      firstDefined(record, [
        "memoryContexts",
        "memory_contexts",
      ]),
    );

  if (
    inFlight === null ||
    memoryContexts === null
  ) {
    return null;
  }

  return {
    inFlight,
    memoryContexts,
  };
}

function countByState(records, selector) {
  const counts = Object.create(null);

  for (const record of records) {
    const state = selector(record) ?? "UNKNOWN";
    counts[state] = (counts[state] ?? 0) + 1;
  }

  return counts;
}

function assertStoreMethod(store, methodName) {
  if (!store || typeof store[methodName] !== "function") {
    throw new TypeError(
      `OperationalService requires ${methodName}()`,
    );
  }
}

export class OperationalService {
  constructor({
    jobStore,
    ipAllocator,
    proxyPool,
    finalResultStore,
    readinessProvider = null,
    runtimeStatusProvider = null,
  }) {
    assertStoreMethod(jobStore, "listIncompleteJobs");
    assertStoreMethod(jobStore, "getJobById");

    assertStoreMethod(
      ipAllocator,
      "getActiveForJob",
    );
    assertStoreMethod(
      ipAllocator,
      "listLiveAllocations",
    );

    assertStoreMethod(proxyPool, "listProxies");
    assertStoreMethod(
      proxyPool,
      "countHealthyAvailable",
    );

    assertStoreMethod(
      finalResultStore,
      "getByJobId",
    );

    if (
      readinessProvider !== null &&
      typeof readinessProvider !== "function"
    ) {
      throw new TypeError(
        "readinessProvider must be a function or null",
      );
    }

    if (
      runtimeStatusProvider !== null &&
      typeof runtimeStatusProvider !== "function"
    ) {
      throw new TypeError(
        "runtimeStatusProvider must be a function or null",
      );
    }

    this.jobStore = jobStore;
    this.ipAllocator = ipAllocator;
    this.proxyPool = proxyPool;
    this.finalResultStore = finalResultStore;
    this.readinessProvider = readinessProvider;
    this.runtimeStatusProvider = runtimeStatusProvider;
  }

  getOverview() {
    const jobs = this.jobStore.listIncompleteJobs() ?? [];
    const proxies = this.proxyPool.listProxies() ?? [];
    const allocations =
      this.ipAllocator.listLiveAllocations() ?? [];

    const safeJobs = jobs.map(projectJob);
    const safeProxies = proxies.map(projectProxy);
    const safeAllocations =
      allocations.map(projectAllocation);

    return {
      jobs: {
        incomplete: safeJobs.length,
        byState: countByState(
          safeJobs,
          (job) => job.state,
        ),
        manualChallenge: safeJobs.filter(
          (job) => job.manualChallengeRequired,
        ).length,
      },
      proxies: {
        total: safeProxies.length,
        healthyAvailable:
          this.proxyPool.countHealthyAvailable(),
        byState: countByState(
          safeProxies,
          (proxy) => proxy.state,
        ),
      },
      allocations: {
        live: safeAllocations.length,
        byState: countByState(
          safeAllocations,
          (allocation) => allocation.state,
        ),
      },
    };
  }

  listJobs() {
    const jobs = this.jobStore.listIncompleteJobs() ?? [];

    return jobs.map((job) => {
      const projected = projectJob(job);
      const jobId = projected.id;

      if (!jobId) {
        return {
          ...projected,
          allocation: null,
          finalResult: null,
        };
      }

      const allocation =
        this.ipAllocator.getActiveForJob(jobId);

      const finalResult =
        this.finalResultStore.getByJobId(jobId);

      return {
        ...projected,
        allocation: allocation
          ? projectAllocation(allocation)
          : null,
        finalResult: projectFinalResult(finalResult),
      };
    });
  }

  getJob(jobId) {
    if (
      typeof jobId !== "string" ||
      jobId.trim() === ""
    ) {
      throw new TypeError(
        "jobId must be a non-empty string",
      );
    }

    const job = this.jobStore.getJobById(jobId);

    if (!job) {
      return null;
    }

    const allocation =
      this.ipAllocator.getActiveForJob(jobId);

    const finalResult =
      this.finalResultStore.getByJobId(jobId);

    return {
      ...projectJob(job),
      allocation: allocation
        ? projectAllocation(allocation)
        : null,
      finalResult: projectFinalResult(finalResult),
    };
  }

  listProxies() {
    const proxies = this.proxyPool.listProxies() ?? [];

    return proxies.map(projectProxy);
  }

  listLiveAllocations() {
    const allocations =
      this.ipAllocator.listLiveAllocations() ?? [];

    return allocations.map(projectAllocation);
  }

  getCapacity() {
    const healthyAvailable =
      this.proxyPool.countHealthyAvailable();

    return {
      healthyAvailable,
      hasCapacity:
        typeof healthyAvailable === "number"
          ? healthyAvailable > 0
          : null,
    };
  }

  async getRuntimeStatus() {
    if (!this.runtimeStatusProvider) {
      return {
        configured: false,
        status: null,
      };
    }

    try {
      const rawStatus =
        await this.runtimeStatusProvider();

      const status =
        projectRuntimeStatus(rawStatus);

      if (!status) {
        return {
          configured: true,
          status: null,
          reason: "INVALID_RUNTIME_STATUS",
        };
      }

      return {
        configured: true,
        status,
      };
    } catch (error) {
      return {
        configured: true,
        status: null,
        error:
          sanitizeOperationalError(error),
      };
    }
  }

  async getReadiness() {
    if (!this.readinessProvider) {
      return {
        configured: false,
        ready: false,
        reason: "READINESS_PROVIDER_NOT_CONFIGURED",
      };
    }

    try {
      const result = await this.readinessProvider();

      if (!isObject(result)) {
        return {
          configured: true,
          ready: false,
          reason: "INVALID_READINESS_RESULT",
        };
      }

      return {
        configured: true,
        ready:
          typeof result.ready === "boolean"
            ? result.ready
            : false,
        reason: asSafeString(result.reason),
        capacity: asSafeNumber(result.capacity),
        checkedAt: asSafeTimestamp(
          firstDefined(result, [
            "checkedAt",
            "checked_at",
          ]),
        ),
      };
    } catch (error) {
      return {
        configured: true,
        ready: false,
        reason: "READINESS_CHECK_FAILED",
        error: {
          ...sanitizeOperationalError(error),
        },
      };
    }
  }
}