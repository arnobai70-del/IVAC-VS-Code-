import http from "node:http";
import { URL } from "node:url";

import {
  sanitizeOperationalError,
  sanitizeOperationalValue,
} from "./redaction.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;

const JSON_HEADERS = Object.freeze({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
});

function normalizeHost(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_HOST;
  }

  if (typeof value !== "string") {
    throw new TypeError("dashboard host must be a string");
  }

  return value;
}

function normalizePort(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_PORT;
  }

  const numeric = Number(value);

  if (
    !Number.isInteger(numeric) ||
    numeric < 1 ||
    numeric > 65_535
  ) {
    throw new TypeError(
      "dashboard port must be an integer between 1 and 65535",
    );
  }

  return numeric;
}

function writeJson(response, statusCode, body) {
  const safeBody = sanitizeOperationalValue(body);

  response.writeHead(statusCode, JSON_HEADERS);
  response.end(
    JSON.stringify(safeBody ?? null),
  );
}

function writeMethodNotAllowed(response, allowedMethods) {
  response.setHeader("allow", allowedMethods.join(", "));
  writeJson(response, 405, {
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: "Method not allowed",
    },
  });
}

function writeNotFound(response) {
  writeJson(response, 404, {
    error: {
      code: "NOT_FOUND",
      message: "Operational endpoint not found",
    },
  });
}

function writeInternalError(response, error) {
  writeJson(response, 500, {
    error: {
      code: "OPERATIONAL_API_ERROR",
      message: "Operational request failed",
      detail: sanitizeOperationalError(error),
    },
  });
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function matchJobDetailPath(pathname) {
  const match = /^\/api\/dashboard\/jobs\/([^/]+)$/.exec(
    pathname,
  );

  if (!match) {
    return null;
  }

  return decodePathSegment(match[1]);
}

function assertOperationalService(service) {
  const requiredMethods = [
    "getOverview",
    "listJobs",
    "getJob",
    "listProxies",
    "listLiveAllocations",
    "getCapacity",
    "getRuntimeStatus",
    "getReadiness",
  ];

  for (const methodName of requiredMethods) {
    if (
      !service ||
      typeof service[methodName] !== "function"
    ) {
      throw new TypeError(
        `DashboardHttpServer requires operationalService.${methodName}()`,
      );
    }
  }
}

async function routeRequest({
  request,
  response,
  operationalService,
}) {
  if (!request.url) {
    writeNotFound(response);
    return;
  }

  const url = new URL(
    request.url,
    "http://dashboard.invalid",
  );

  const pathname = url.pathname;

  if (
    pathname === "/health" ||
    pathname === "/api/dashboard/health"
  ) {
    if (request.method !== "GET") {
      writeMethodNotAllowed(response, ["GET"]);
      return;
    }

    writeJson(response, 200, {
      ok: true,
      service: "ivac-operational-dashboard",
    });

    return;
  }

  if (pathname === "/api/dashboard/overview") {
    if (request.method !== "GET") {
      writeMethodNotAllowed(response, ["GET"]);
      return;
    }

    writeJson(
      response,
      200,
      operationalService.getOverview(),
    );

    return;
  }

  if (pathname === "/api/dashboard/jobs") {
    if (request.method !== "GET") {
      writeMethodNotAllowed(response, ["GET"]);
      return;
    }

    writeJson(response, 200, {
      jobs: operationalService.listJobs(),
    });

    return;
  }

  const jobId = matchJobDetailPath(pathname);

  if (jobId !== null) {
    if (request.method !== "GET") {
      writeMethodNotAllowed(response, ["GET"]);
      return;
    }

    if (!jobId || jobId.trim() === "") {
      writeJson(response, 400, {
        error: {
          code: "INVALID_JOB_ID",
          message: "Job ID is required",
        },
      });

      return;
    }

    const job = operationalService.getJob(jobId);

    if (!job) {
      writeJson(response, 404, {
        error: {
          code: "JOB_NOT_FOUND",
          message: "Job not found",
        },
      });

      return;
    }

    writeJson(response, 200, {
      job,
    });

    return;
  }

  if (pathname === "/api/dashboard/proxies") {
    if (request.method !== "GET") {
      writeMethodNotAllowed(response, ["GET"]);
      return;
    }

    writeJson(response, 200, {
      proxies: operationalService.listProxies(),
    });

    return;
  }

  if (
    pathname === "/api/dashboard/allocations"
  ) {
    if (request.method !== "GET") {
      writeMethodNotAllowed(response, ["GET"]);
      return;
    }

    writeJson(response, 200, {
      allocations:
        operationalService.listLiveAllocations(),
    });

    return;
  }

  if (pathname === "/api/dashboard/capacity") {
    if (request.method !== "GET") {
      writeMethodNotAllowed(response, ["GET"]);
      return;
    }

    writeJson(
      response,
      200,
      operationalService.getCapacity(),
    );

    return;
  }

  if (pathname === "/api/dashboard/runtime") {
    if (request.method !== "GET") {
      writeMethodNotAllowed(response, ["GET"]);
      return;
    }

    const runtimeStatus =
      await operationalService.getRuntimeStatus();

    writeJson(response, 200, runtimeStatus);

    return;
  }

  if (pathname === "/api/dashboard/readiness") {
    if (request.method !== "GET") {
      writeMethodNotAllowed(response, ["GET"]);
      return;
    }

    const readiness =
      await operationalService.getReadiness();

    writeJson(response, 200, readiness);

    return;
  }

  writeNotFound(response);
}

export class DashboardHttpServer {
  constructor({
    operationalService,
    host = DEFAULT_HOST,
    port = DEFAULT_PORT,
    logger = null,
  }) {
    assertOperationalService(operationalService);

    if (
      logger !== null &&
      typeof logger !== "object"
    ) {
      throw new TypeError(
        "logger must be an object or null",
      );
    }

    this.operationalService = operationalService;
    this.host = normalizeHost(host);
    this.port = normalizePort(port);
    this.logger = logger;

    this.server = null;
    this.started = false;
  }

  getAddress() {
    if (!this.server) {
      return null;
    }

    const address = this.server.address();

    if (!address) {
      return null;
    }

    if (typeof address === "string") {
      return {
        address,
      };
    }

    return {
      address: address.address,
      family: address.family,
      port: address.port,
    };
  }

  async start() {
    if (this.started) {
      return this.getAddress();
    }

    const server = http.createServer(
      async (request, response) => {
        try {
          await routeRequest({
            request,
            response,
            operationalService:
              this.operationalService,
          });
        } catch (error) {
          this.logger?.error?.(
            {
              err: sanitizeOperationalError(error),
            },
            "dashboard request failed",
          );

          if (!response.headersSent) {
            writeInternalError(response, error);
            return;
          }

          response.destroy();
        }
      },
    );

    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 5_000;
    server.maxHeadersCount = 100;

    this.server = server;

    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off("listening", onListening);
          reject(error);
        };

        const onListening = () => {
          server.off("error", onError);
          resolve();
        };

        server.once("error", onError);
        server.once("listening", onListening);

        server.listen(this.port, this.host);
      });

      this.started = true;

      const address = this.getAddress();

      this.logger?.info?.(
        {
          dashboard: {
            host: this.host,
            port: address?.port ?? this.port,
          },
        },
        "operational dashboard started",
      );

      return address;
    } catch (error) {
      this.server = null;
      this.started = false;
      throw error;
    }
  }

  async stop() {
    if (!this.server) {
      this.started = false;
      return;
    }

    const server = this.server;

    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });

      server.closeIdleConnections?.();
    });

    this.server = null;
    this.started = false;

    this.logger?.info?.(
      "operational dashboard stopped",
    );
  }
}

export const DASHBOARD_DEFAULT_HOST = DEFAULT_HOST;
export const DASHBOARD_DEFAULT_PORT = DEFAULT_PORT;