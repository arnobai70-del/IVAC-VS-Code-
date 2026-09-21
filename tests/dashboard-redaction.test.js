import test from "node:test";
import assert from "node:assert/strict";

import {
  OPERATIONAL_REDACTED_VALUE,
  isOperationalSensitiveKey,
  sanitizeOperationalError,
  sanitizeOperationalValue,
} from "../src/dashboard/redaction.js";

test("redacts sensitive operational keys", () => {
  const input = {
    id: "job-1",
    state: "RUNNING",
    password: "super-secret",
    Authorization: "Bearer abc123",
    accessToken: "token-value",
    otp: "123456",
    Cookie: "session=secret",
    "Set-Cookie": "session=secret",
    proxyPassword: "proxy-secret",
  };

  const result = sanitizeOperationalValue(input);

  assert.equal(result.id, "job-1");
  assert.equal(result.state, "RUNNING");

  assert.equal(
    result.password,
    OPERATIONAL_REDACTED_VALUE,
  );

  assert.equal(
    result.Authorization,
    OPERATIONAL_REDACTED_VALUE,
  );

  assert.equal(
    result.accessToken,
    OPERATIONAL_REDACTED_VALUE,
  );

  assert.equal(
    result.otp,
    OPERATIONAL_REDACTED_VALUE,
  );

  assert.equal(
    result.Cookie,
    OPERATIONAL_REDACTED_VALUE,
  );

  assert.equal(
    result["Set-Cookie"],
    OPERATIONAL_REDACTED_VALUE,
  );

  assert.equal(
    result.proxyPassword,
    OPERATIONAL_REDACTED_VALUE,
  );
});

test("redacts unsafe raw containers", () => {
  const result = sanitizeOperationalValue({
    body: {
      safe: false,
    },
    headers: {
      accept: "application/json",
    },
    session: {
      id: "session-1",
    },
    cookieJar: {
      cookies: [],
    },
    dispatcher: {
      internal: true,
    },
    portalPayload: {
      applicant: "sensitive",
    },
    requestBody: "sensitive",
    responseBody: "sensitive",
  });

  assert.equal(
    result.body,
    OPERATIONAL_REDACTED_VALUE,
  );

  assert.equal(
    result.headers,
    OPERATIONAL_REDACTED_VALUE,
  );

  assert.equal(
    result.session,
    OPERATIONAL_REDACTED_VALUE,
  );

  assert.equal(
    result.cookieJar,
    OPERATIONAL_REDACTED_VALUE,
  );

  assert.equal(
    result.dispatcher,
    OPERATIONAL_REDACTED_VALUE,
  );

  assert.equal(
    result.portalPayload,
    OPERATIONAL_REDACTED_VALUE,
  );

  assert.equal(
    result.requestBody,
    OPERATIONAL_REDACTED_VALUE,
  );

  assert.equal(
    result.responseBody,
    OPERATIONAL_REDACTED_VALUE,
  );
});

test("redacts binary data instead of serializing it", () => {
  const result = sanitizeOperationalValue({
    document: Buffer.from("%PDF-secret"),
    bytes: new Uint8Array([1, 2, 3]),
  });

  assert.equal(
    result.document,
    OPERATIONAL_REDACTED_VALUE,
  );

  assert.equal(
    result.bytes,
    OPERATIONAL_REDACTED_VALUE,
  );
});

test("removes bearer and basic credentials from strings", () => {
  const result = sanitizeOperationalValue({
    bearerMessage:
      "request failed using Bearer abc.def.ghi",
    basicMessage:
      "request failed using Basic dXNlcjpwYXNz",
  });

  assert.equal(
    result.bearerMessage,
    `request failed using ${OPERATIONAL_REDACTED_VALUE}`,
  );

  assert.equal(
    result.basicMessage,
    `request failed using ${OPERATIONAL_REDACTED_VALUE}`,
  );
});

test("sanitizes operational errors without exposing arbitrary fields", () => {
  const error = new Error(
    "request failed with Bearer top-secret",
  );

  error.code = "TARGET_FAILURE";
  error.category = "NETWORK";
  error.retryable = true;
  error.statusCode = 503;

  error.password = "must-not-leak";
  error.otp = "123456";
  error.responseBody = "sensitive-body";

  const result = sanitizeOperationalError(error);

  assert.deepEqual(
    { ...result },
    {
      name: "Error",
      code: "TARGET_FAILURE",
      message:
        `request failed with ${OPERATIONAL_REDACTED_VALUE}`,
      category: "NETWORK",
      retryable: true,
      statusCode: 503,
    },
  );

  assert.equal(
    Object.hasOwn(result, "password"),
    false,
  );

  assert.equal(
    Object.hasOwn(result, "otp"),
    false,
  );

  assert.equal(
    Object.hasOwn(result, "responseBody"),
    false,
  );
});

test("handles circular objects safely", () => {
  const input = {
    id: "job-1",
  };

  input.self = input;

  const result = sanitizeOperationalValue(input);

  assert.equal(result.id, "job-1");
  assert.equal(result.self, "[CIRCULAR]");
});

test("rejects unsupported object instances from operational output", () => {
  class SensitiveContainer {
    constructor() {
      this.secret = "hidden";
    }
  }

  const result = sanitizeOperationalValue({
    value: new SensitiveContainer(),
  });

  assert.equal(
    result.value,
    "[UNSUPPORTED_OBJECT]",
  );
});

test("sensitive key detection covers dashboard security boundary", () => {
  const sensitiveKeys = [
    "Authorization",
    "proxy-authorization",
    "password",
    "accessToken",
    "refresh_token",
    "apiKey",
    "otp",
    "Cookie",
    "Set-Cookie",
    "session",
    "cookieJar",
    "headers",
    "body",
    "portalPayload",
    "dispatcher",
  ];

  for (const key of sensitiveKeys) {
    assert.equal(
      isOperationalSensitiveKey(key),
      true,
      `${key} should be sensitive`,
    );
  }

  const safeKeys = [
    "id",
    "state",
    "retryCount",
    "currentStep",
    "createdAt",
  ];

  for (const key of safeKeys) {
    assert.equal(
      isOperationalSensitiveKey(key),
      false,
      `${key} should not be sensitive`,
    );
  }
});