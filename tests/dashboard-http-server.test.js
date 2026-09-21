import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";

import { DashboardHttpServer } from "../src/dashboard/http-server.js";

function createOperationalService() {
  return {
    getOverview() {
      return {
        jobs: {
          incomplete: 1,
          byState: {
            RUNNING: 1,
          },
          manualChallenge: 0,
        },
        proxies: {
          total: 2,
          healthyAvailable: 1,
          byState: {
            ACTIVE: 1,
            AVAILABLE: 1,
          },
        },
        allocations: {
          live: 1,
          byState: {
            ACTIVE: 1,
          },
        },
      };
    },

    listJobs() {
      return [
        {
          id: "job-1",
          state: "RUNNING",
          retryCount: 1,
          password: "must-not-leak",
          Authorization: "Bearer secret",
        },
      ];
    },

    getJob(jobId) {
      if (jobId !== "job-1") {
        return null;
      }

      return {
        id: "job-1",
        state: "RUNNING",
        currentStep: "slot.search",
        cookie: "must-not-leak",
        otp: "123456",
      };
    },

    listProxies() {
      return [
        {
          id: "proxy-1",
          state: "ACTIVE",
          password: "proxy-secret",
        },
      ];
    },

    listLiveAllocations() {
      return [
        {
          id: "allocation-1",
          jobId: "job-1",
          proxyId: "proxy-1",
          state: "ACTIVE",
          dispatcher: {
            internal: true,
          },
        },
      ];
    },

    getCapacity() {
      return {
        healthyAvailable: 1,
        hasCapacity: true,
      };
    },

    async getReadiness() {
      return {
        configured: false,
        ready: false,
        reason: "READINESS_PROVIDER_NOT_CONFIGURED",
      };
    },
  };
}

function httpJson({
  port,
  path,
  method = "GET",
}) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,

        /*
         * Do not reuse sockets between test server instances.
         * Tests intentionally start and stop servers on a bounded
         * set of localhost ports, so a pooled keep-alive socket
         * could otherwise point at a server that has just closed.
         */
        agent: false,
      },
      (res) => {
        const chunks = [];

        res.on("data", (chunk) => {
          chunks.push(chunk);
        });

        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");

          let parsed = null;

          if (body !== "") {
            parsed = JSON.parse(body);
          }

          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsed,
          });
        });
      },
    );

    req.on("error", reject);
    req.end();
  });
}

async function withServer(callback) {
  const candidatePorts = [
    18787,
    18788,
    18789,
    18790,
    18791,
  ];

  let server = null;
  let started = false;
  let lastError = null;

  for (const port of candidatePorts) {
    server = new DashboardHttpServer({
      operationalService: createOperationalService(),
      host: "127.0.0.1",
      port,
    });

    try {
      await server.start();
      started = true;
      break;
    } catch (error) {
      lastError = error;

      if (error?.code !== "EADDRINUSE") {
        throw error;
      }

      server = null;
    }
  }

  if (!started || !server) {
    throw (
      lastError ??
      new Error("Unable to start dashboard test server")
    );
  }

  try {
    const address = server.getAddress();

    assert.ok(address);
    assert.equal(typeof address.port, "number");

    await callback(address.port);
  } finally {
    await server.stop();
  }
}

test("health endpoint returns service health", async () => {
  await withServer(async (port) => {
    const response = await httpJson({
      port,
      path: "/health",
    });

    assert.equal(response.statusCode, 200);

    assert.deepEqual(response.body, {
      ok: true,
      service: "ivac-operational-dashboard",
    });

    assert.match(
      response.headers["content-type"],
      /application\/json/i,
    );

    assert.equal(
      response.headers["cache-control"],
      "no-store",
    );
  });
});

test("overview endpoint returns operational aggregate", async () => {
  await withServer(async (port) => {
    const response = await httpJson({
      port,
      path: "/api/dashboard/overview",
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.jobs.incomplete, 1);
    assert.equal(
      response.body.proxies.healthyAvailable,
      1,
    );
    assert.equal(
      response.body.allocations.live,
      1,
    );
  });
});

test("jobs endpoint applies final response redaction", async () => {
  await withServer(async (port) => {
    const response = await httpJson({
      port,
      path: "/api/dashboard/jobs",
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.jobs.length, 1);

    const job = response.body.jobs[0];

    assert.equal(job.id, "job-1");
    assert.equal(job.state, "RUNNING");

    assert.equal(
      job.password,
      "[REDACTED]",
    );

    assert.equal(
      job.Authorization,
      "[REDACTED]",
    );

    const serialized = JSON.stringify(response.body);

    assert.doesNotMatch(
      serialized,
      /must-not-leak/i,
    );

    assert.doesNotMatch(
      serialized,
      /Bearer secret/i,
    );
  });
});

test("job detail endpoint returns matching job", async () => {
  await withServer(async (port) => {
    const response = await httpJson({
      port,
      path: "/api/dashboard/jobs/job-1",
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.job.id, "job-1");
    assert.equal(
      response.body.job.currentStep,
      "slot.search",
    );

    assert.equal(
      response.body.job.cookie,
      "[REDACTED]",
    );

    assert.equal(
      response.body.job.otp,
      "[REDACTED]",
    );
  });
});

test("unknown job returns 404", async () => {
  await withServer(async (port) => {
    const response = await httpJson({
      port,
      path: "/api/dashboard/jobs/missing-job",
    });

    assert.equal(response.statusCode, 404);

    assert.equal(
      response.body.error.code,
      "JOB_NOT_FOUND",
    );
  });
});

test("proxy endpoint redacts credentials", async () => {
  await withServer(async (port) => {
    const response = await httpJson({
      port,
      path: "/api/dashboard/proxies",
    });

    assert.equal(response.statusCode, 200);
    assert.equal(
      response.body.proxies[0].id,
      "proxy-1",
    );

    assert.equal(
      response.body.proxies[0].password,
      "[REDACTED]",
    );

    assert.doesNotMatch(
      JSON.stringify(response.body),
      /proxy-secret/i,
    );
  });
});

test("allocation endpoint redacts unsafe containers", async () => {
  await withServer(async (port) => {
    const response = await httpJson({
      port,
      path: "/api/dashboard/allocations",
    });

    assert.equal(response.statusCode, 200);

    assert.equal(
      response.body.allocations[0].dispatcher,
      "[REDACTED]",
    );
  });
});

test("capacity endpoint returns safe capacity state", async () => {
  await withServer(async (port) => {
    const response = await httpJson({
      port,
      path: "/api/dashboard/capacity",
    });

    assert.equal(response.statusCode, 200);

    assert.deepEqual(response.body, {
      healthyAvailable: 1,
      hasCapacity: true,
    });
  });
});

test("readiness endpoint returns fail-closed readiness", async () => {
  await withServer(async (port) => {
    const response = await httpJson({
      port,
      path: "/api/dashboard/readiness",
    });

    assert.equal(response.statusCode, 200);

    assert.deepEqual(response.body, {
      configured: false,
      ready: false,
      reason: "READINESS_PROVIDER_NOT_CONFIGURED",
    });
  });
});

test("non-GET methods are rejected", async () => {
  await withServer(async (port) => {
    const response = await httpJson({
      port,
      path: "/api/dashboard/jobs",
      method: "POST",
    });

    assert.equal(response.statusCode, 405);

    assert.equal(
      response.body.error.code,
      "METHOD_NOT_ALLOWED",
    );

    assert.equal(
      response.headers.allow,
      "GET",
    );
  });
});

test("unknown endpoint returns 404", async () => {
  await withServer(async (port) => {
    const response = await httpJson({
      port,
      path: "/api/dashboard/unknown",
    });

    assert.equal(response.statusCode, 404);

    assert.equal(
      response.body.error.code,
      "NOT_FOUND",
    );
  });
});

test("server start is idempotent and stop is safe", async () => {
  const server = new DashboardHttpServer({
    operationalService: createOperationalService(),
    host: "127.0.0.1",
    port: 18792,
  });

  try {
    const first = await server.start();
    const second = await server.start();

    assert.deepEqual(second, first);
    assert.equal(server.started, true);
  } finally {
    await server.stop();
    await server.stop();
  }

  assert.equal(server.started, false);
  assert.equal(server.getAddress(), null);
});