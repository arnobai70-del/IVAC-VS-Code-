# IVAC Automation Platform

A safety-focused Node.js automation runtime for bounded IVAC authentication workflows, durable job lifecycle management, exclusive per-job IP allocation, OTP handling, PDF document processing, conservative retry/recovery, final-result delivery, and read-only operational observability.

The system is designed to remain fail-closed and non-destructive by default.

## Release Status

Current planned implementation checkpoint:

- Phase 39 release validation: complete
- Phase 40 documentation / runbook / final release checkpoint: current final checkpoint
- Phase 39 remote checkpoint: `4dce688c5ca267f6e498159e65b1ddd202a85597`
- automated tests: `526`
- passing: `526`
- failing: `0`
- production dependency audit: `0 vulnerabilities`
- Node.js release requirement: `>=22.0.0`

The completed automated checks validate the repository state exercised by those checks. They are not a claim that software can never contain defects.

## Project Scope

The current IVAC target workflow is intentionally bounded to verified authentication behavior.

Verified IVAC target routes:

- `POST /auth/sign-in-v2`
- `POST /otp/verifySigninOtp`

The repository does not claim support for IVAC payment, appointment submission, application submission, or other unverified target operations.

No unverified IVAC endpoint may be added to workflow execution merely because a route is guessed or observed elsewhere.

## Completed Phases

1. Foundation
2. SQLite / Durable Job State
3. Proxy / IP Allocation
4. Safe Portal Intake
5. Per-job Session / Client Isolation
6. OTP HTML Table Integration
7. Safe JSON Workflow Engine
8. Portal PDF Document Pipeline
9. Final Result Capture / Idempotent Finalization
10. Read-Only Operational Dashboard API
11. Restart Recovery + Bounded Retry + Graceful Shutdown
12. Guarded Portal Intake Runtime
13. Intake-to-Workflow Runtime Execution
14. Bounded Runtime Workflow Retry
15. Safe Manual Challenge Resume Lifecycle
16. Fail-Closed Workflow Runtime Gate
17. Safe Final-Result Restart Recovery
18. Verified Portal Runtime Contract Integration
19. IVAC Workflow Policy Layer
20. IVAC Target Contract Boundary
21. IVAC Target Contract Metadata Hardening
22. IVAC Target Contract Runtime Enforcement
23. Workflow Readiness Inspection
24. Runtime Execution Status Dashboard Bridge
25. Runtime Status Contract Hardening
26. Project Checkpoint / Bootstrap Status Synchronization
27. Target Contract Bootstrap Wiring
28. Verified IVAC Target Contract Route / Method Hardening
29. Actual IVAC Workflow from Verified Contract Only
30. Runtime Readiness Gates
31. Proxy Readiness
32. Secrets / Environment Readiness
33. Controlled Activation Profile
34. Non-destructive E2E
35. Manual Challenge Operations
36. Observability
37. Restart / Crash Recovery Matrix
38. Security Audit + Runtime Safety Hardening
39. Release Validation
40. README / Runbook / Final Release Checkpoint

## Architecture Overview

The runtime is organized around strict job isolation and bounded state transitions.

Primary components:

- `src/jobs/` — durable job lifecycle and job context
- `src/db/` — SQLite database initialization and migrations
- `src/network/` — proxy loading, health state, IP allocation, dispatcher isolation, readiness
- `src/session/` — per-job cookies, dispatcher/session ownership, HTTP client
- `src/portal/` — Portal readiness, pending intake, mapping, final-result contract
- `src/otp/` — OTP table retrieval, parsing, matching, timeout behavior
- `src/documents/` — bounded PDF download, validation, memory-only handling, multipart upload
- `src/workflow/` — schema validation, policy, safe templates, target contract enforcement, auth workflow
- `src/contracts/` — verified IVAC target contract definitions
- `src/runtime/` — execution, retry, activation, readiness, observability, challenge operations, shutdown
- `src/recovery/` — durable restart classification and conservative recovery behavior
- `src/results/` — durable final-result ledger and delivery lifecycle
- `src/dashboard/` — read-only loopback operational API

## Safety Model

Normal startup does not activate destructive Portal intake.

Default behavior:

- activation profile: `safe`
- Portal intake: disabled
- workflow runtime: disabled
- workflow definition: disabled
- Portal final-result delivery: disabled
- operational dashboard: disabled
- Portal API token: not required
- proxy configuration: may be absent
- human-verification bypass: disabled
- automatic manual-challenge resume: disabled

Launching the application in this state must not consume pending Portal work.

Activation must pass independent readiness boundaries. Destructive intake is blocked if required runtime, workflow, target-contract, result-delivery, secret, activation, or proxy requirements are not satisfied.

Unknown execution failures are not automatically treated as retryable. Uncertain non-idempotent mutations are not blindly replayed.

## Requirements

Required tooling:

- Windows
- PowerShell
- Git
- Node.js `>=22.0.0`
- npm compatible with the installed Node.js release

Validated Phase 39 environment:

- Node.js `v24.18.0`
- npm `12.0.2`

Check local versions:

```powershell
node --version
npm --version
git --version
```

`better-sqlite3@13.0.3` requires Node.js `>=22`.

The project declares:

```json
{
  "engines": {
    "node": ">=22.0.0"
  }
}
```

## Installation

```powershell
git clone https://github.com/arnobai70-del/IVAC-VS-Code-.git
cd IVAC-VS-Code-
npm ci
```

The repository intentionally denies the implicit `better-sqlite3` install script:

```json
{
  "allowScripts": {
    "better-sqlite3": false
  }
}
```

Review install-script policy:

```powershell
npm install-scripts ls
```

Expected release state:

```text
No packages with unreviewed install scripts.
```

## Environment Configuration

Local secrets and operator overrides are loaded from `.env.local`.

Create it from `.env.example`:

```powershell
Copy-Item .env.example .env.local
```

Supported environment values:

- `PORTAL_API_ACCESS_TOKEN` — Portal API credential where the verified Portal contract requires authentication.
- `ACTIVATION_PROFILE` — `safe` or `controlled`.
- `APP_ENV` — optional application environment override.
- `LOG_LEVEL` — optional structured logger level override.

Safe startup does not require the Portal API token while intake remains disabled.

Never commit `.env.local`.

## Static Configuration

Primary configuration:

`config/app.json`

Major groups:

- `app`
- `runtime`
- `database`
- `network`
- `portal`
- `otp`
- `documents`
- `target`
- `workflow`
- `logging`

Dashboard configuration is schema-defaulted when omitted.

Repository runtime defaults include:

```json
{
  "runtime": {
    "concurrency": 2,
    "jobsPerCycle": 2,
    "requestDelayMs": 250,
    "intakeEnabled": false,
    "intakePollIntervalMs": 3000
  }
}
```

`activationProfile` defaults to `safe`.

## Workflow Configuration

Workflow definition:

`config/workflow.json`

The workflow is intentionally disabled by default.

Current bounded auth workflow contains four steps:

1. `prepare_signin_otp` — `otp.prepare`
2. `sign_in` — `POST /auth/sign-in-v2`
3. `wait_signin_otp` — `otp.wait`
4. `verify_signin_otp` — `POST /otp/verifySigninOtp`

Supported policy step types:

- `http`
- `otp.prepare`
- `otp.wait`
- `documents.prepare`
- `documents.upload`

Workflow templates do not use `eval` or `new Function`. Unsafe prototype access is rejected. Absolute external target routes are rejected.

## IVAC Target Contract

The current verified target contract authorizes only:

```text
POST /auth/sign-in-v2
POST /otp/verifySigninOtp
```

Method and path must both match the verified contract.

A verified path does not authorize another HTTP method. Dynamic or unverified target routes fail closed.

The repository does not authorize payment or application-submission routes.

## Portal Runtime Contract

The Portal integration is separate from the IVAC target contract.

Current configured Portal boundaries include:

- authenticated health: `GET /api/novaflow/v1/ping`
- pending application intake: `GET /api/application/pending`
- final-result status: `POST /api/application/{application}/status`

Portal service URLs used by production-facing configuration must remain HTTPS and must not contain embedded credentials.

Configured Portal paths must remain same-origin and must not use unsafe network-path references.

Portal uses a configured static `Server-Name` worker identity. This worker identity is separate from the per-job reserved proxy/IP allocation.

## OTP Integration

OTP integration operates through an HTML table source.

Current behavior includes:

- same per-job HTTP client
- baseline capture before waiting
- exact normalized phone matching
- header-based table parsing
- bounded polling timeout
- bounded HTML response size
- bounded row count
- OTP isolation to the requesting job
- manual challenge detection

OTP values must not be logged or stored in durable recovery metadata.

Repository defaults:

```text
pollIntervalMs: 3000
timeoutMs: 120000
maxRows: 5000
```

## PDF Document Pipeline

Safety boundaries include:

- source-origin allowlist
- same-job HTTP client
- no direct network fallback
- PDF Content-Type validation
- PDF signature validation
- bounded document count
- bounded individual file size
- bounded total size
- duplicate content rejection
- memory-only PDF buffers
- multipart upload
- no temporary PDF files on disk
- manual challenge propagation
- no blind document-upload replay after uncertain restart state

Current limits:

```text
maxCount: 8
maxFileBytes: 10485760
maxTotalBytes: 31457280
```

## Proxy Configuration

Private proxy configuration path:

`config/proxies.json`

This file is gitignored because it may contain proxy credentials.

Document format:

```json
{
  "version": 1,
  "proxies": [
    {
      "id": "proxy-1",
      "ip": "203.0.113.10",
      "port": 8080,
      "protocol": "http",
      "enabled": true,
      "username": "optional-user",
      "password": "optional-password",
      "label": "optional-label"
    }
  ]
}
```

Supported protocols:

- `http`
- `https`

Rules:

- proxy IDs must be unique
- IP/port endpoints must be unique
- username and password must either both exist or both be omitted
- disabled proxies are not usable capacity
- credentials must never be exposed through dashboard responses

Do not commit real proxy credentials.

## Proxy Readiness

Destructive intake requires:

- proxy configuration source exists
- health-check URL is configured
- at least one proxy is enabled
- at least one enabled proxy is healthy and available

Fail-closed blockers include:

```text
PROXY_CONFIG_NOT_FOUND
PROXY_HEALTH_CHECK_NOT_CONFIGURED
NO_ENABLED_PROXIES
NO_HEALTHY_PROXY_CAPACITY
PROXY_PROBE_ERROR
```

Safe startup may report blocked proxy readiness without failing while destructive intake is disabled.

## One Active Job = One Reserved IP

A live job owns one reserved allocation.

Important rules:

- one active job cannot share another active job's allocation
- retry must preserve the same allocation
- manual challenge state must preserve the same allocation
- pending final-result delivery must preserve the same allocation
- replacement IP acquisition is not automatic
- allocation identity changes fail closed
- IP is released only after terminal lifecycle completion

## Per-Job Session Isolation

Each active job receives isolated network state:

- dedicated JobContext
- dedicated CookieJar
- allocation-bound dispatcher
- allocation-bound JobHttpClient
- isolated workflow state

Target, OTP, and document operations for a job use that same per-job client/session.

Cross-job cookie or session sharing is prohibited. Sessions and cookies are memory-only.

## Retry Behavior

Runtime retry is bounded.

Default maximum retries: `3`

Default retry delays:

```text
1000 ms
5000 ms
15000 ms
```

Only explicitly retryable failures enter the retry path.

Retry properties:

- same job
- same execution input while process memory remains available
- same IP/allocation
- same session/context
- durable retry count
- bounded delay
- no manual-challenge auto retry
- no graceful-shutdown retry
- unknown errors fail closed

Retry exhaustion produces an explicit terminal execution failure path rather than an unbounded retry loop.

## Manual Challenge Contract

Human verification is never bypassed.

Human-verification or anti-bot challenge detection surfaces:

`MANUAL_CHALLENGE_REQUIRED`

Rules:

- automatic resume: false
- explicit resume only
- same process required
- original JobContext required
- original session required
- same IP required
- replacement IP forbidden
- restart resume unsupported
- challenge solution is not accepted by the operation boundary
- no dashboard mutation endpoint
- repeated challenge remains non-terminal
- retry budget is not consumed merely because a manual challenge occurred

There is no CAPTCHA, Cloudflare, Turnstile, reCAPTCHA, hCaptcha, or other human-verification bypass implementation.

## Final Result Lifecycle

Final-result handling uses a durable ledger.

Properties include:

- deterministic result normalization
- deterministic idempotency key
- sensitive-field rejection
- binary/PDF payload rejection
- local duplicate-send protection
- delivery attempt tracking
- terminal transition only after verified acknowledgement
- same-IP preservation while result delivery remains pending
- final-result delivery outside workflow retry boundary

Durable delivery states include:

```text
PENDING
IN_FLIGHT
UNCERTAIN
DELIVERED
```

Uncertain delivery is not blindly replayed.

The current Portal result contract declares verified remote idempotent replay as unsupported.

## Restart and Crash Recovery

Recovery is conservative.

- Pre-execution states may remain recoverable without consuming retry budget.
- Interrupted `RUNNING` / `WAITING_FOR_OTP` may schedule bounded retry only when the same allocation identity remains recoverable.
- Existing `RETRY_PENDING` budget is preserved.
- `WAITING_FOR_MANUAL_CHALLENGE` never automatically resumes after restart.
- Document upload crash points are not blindly replayed without verified idempotency.
- Stale final-result `IN_FLIGHT` becomes conservative `UNCERTAIN`.
- `UNCERTAIN` final result is not blindly replayed.
- `DELIVERED` may continue terminalization without re-sending the result.

## Durable vs Memory-Only State

Durable operational state includes:

- job lifecycle state
- retry count
- IP allocation metadata
- intake reservations / claims
- recovery metadata
- final-result ledger
- final-result delivery state

Intentionally memory-only state includes:

- sensitive execution input
- Portal password
- session cookies
- HTTP session state
- JobContext runtime secrets
- OTP state/value
- PDF buffers
- same-process workflow response cache
- manual challenge execution context

A restart therefore cannot reconstruct a manual challenge session or other intentionally memory-only execution state.

## Graceful Shutdown

Graceful shutdown coordinates:

- stop accepting new intake
- stop intake polling
- abort active workflow execution
- abort active manual resume
- abort retry wait
- wait within a bounded shutdown deadline
- clean session/dispatcher resources

Non-terminal IP allocations are not released merely because the process is shutting down.

## Observability

Runtime observability exposes bounded operational state only and is designed to avoid raw workflow payloads, credentials, OTP values, cookies, proxy credentials, or arbitrary provider objects.

Observability timestamps and safety flags are validated before exposure.

## Read-Only Operational Dashboard

The dashboard is disabled by default.

Schema defaults:

```json
{
  "dashboard": {
    "enabled": false,
    "host": "127.0.0.1",
    "port": 8787
  }
}
```

Allowed bind hosts:

```text
127.0.0.1
::1
localhost
```

Available read-only routes:

```text
GET /health
GET /api/dashboard/health
GET /api/dashboard/overview
GET /api/dashboard/jobs
GET /api/dashboard/jobs/{jobId}
GET /api/dashboard/proxies
GET /api/dashboard/allocations
GET /api/dashboard/capacity
GET /api/dashboard/runtime
GET /api/dashboard/observability
GET /api/dashboard/readiness
```

The dashboard intentionally has no mutation endpoint and no manual-challenge resume endpoint.

Responses pass through operational redaction.

## Activation Profiles

### `safe`

Default profile. It cannot authorize destructive intake.

Recommended for development, tests, verification, release checks, and non-destructive startup.

### `controlled`

Explicit operator-selected profile.

Selecting it only arms the activation profile. It does not automatically enable workflow runtime, workflow definition, Portal result delivery, Portal intake, proxy readiness, or secret readiness.

All applicable readiness gates must still pass.

## Production / Controlled Activation Prerequisites

Do not activate destructive intake until all required conditions are intentionally satisfied.

At minimum:

1. Node.js satisfies `>=22.0.0`.
2. repository validation is green.
3. `ACTIVATION_PROFILE=controlled`.
4. runtime workflow execution is explicitly enabled.
5. `config/workflow.json` is intentionally enabled.
6. workflow definition passes schema and IVAC policy validation.
7. verified target contract matches every workflow HTTP method/path.
8. only verified IVAC target routes are used.
9. Portal final-result delivery is explicitly enabled.
10. Portal API access token is configured.
11. Portal worker `Server-Name` is configured.
12. Portal service configuration is valid and same-origin-safe.
13. proxy configuration exists.
14. proxy health-check URL is configured.
15. at least one enabled proxy is healthy and available.
16. destructive intake is explicitly enabled.
17. no readiness gate reports a blocker.

Controlled activation remains an operator action.

Do not turn on every switch merely to make readiness appear green.

## Safe Startup

Safe startup command:

```powershell
npm start
```

With repository defaults, expected behavior includes:

- bootstrap succeeds
- activation profile is `safe`
- intake is disabled
- workflow runtime is disabled
- workflow definition is disabled
- Portal final-result contract is disabled
- dashboard is disabled
- missing production token does not break safe startup
- missing proxy configuration remains a readiness blocker rather than triggering destructive behavior

## Validation Commands

Normal release validation:

```powershell
npm run check
npm test
npm audit --omit=dev
npm install-scripts ls
npm start
git diff --check
git status --short
```

Phase 39 validated:

```text
tests: 526
pass: 526
fail: 0
production vulnerabilities: 0
unreviewed install scripts: 0
```

Native SQLite smoke test:

```powershell
node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, value TEXT)'); db.prepare('INSERT INTO t(value) VALUES (?)').run('ok'); console.log(db.prepare('SELECT value FROM t').get()); db.close();"
```

## Security Boundaries

The project must not add or enable:

- CAPTCHA bypass
- Cloudflare bypass
- Turnstile bypass
- reCAPTCHA bypass
- hCaptcha bypass
- other anti-bot / human-verification bypass
- credential stealing
- cookie stealing
- token logging
- OTP logging
- fake production endpoints
- unverified IVAC target endpoints
- arbitrary IP switching
- cross-job session sharing
- blind destructive retries
- unbounded retries
- blind replay after uncertain mutation

Production-facing configured service URLs are required to use HTTPS where enforced by the application schema.

Embedded URL credentials are rejected.

Portal routes are constrained to the configured origin.

Outbound Portal result header control characters are rejected.

## Sensitive Files and Git Hygiene

The repository ignores:

- `node_modules/`
- `.env`
- `.env.local`
- `.env.*.local`
- `config/proxies.json`
- runtime SQLite files
- logs
- results
- temporary directories
- coverage output

The public template `.env.example` remains tracked.

Never force-add ignored secrets, proxy inventories, databases, or runtime output.

## Troubleshooting Runbook

### `INTAKE_DISABLED`

Expected during safe startup.

### `WORKFLOW_RUNTIME_DISABLED`

Workflow runtime activation is off. Expected by default.

### `WORKFLOW_DEFINITION_DISABLED`

`config/workflow.json` remains disabled. Expected by default.

### `PORTAL_RESULT_NOT_CONFIGURED`

Verified final-result delivery is not active. Destructive intake must remain blocked.

### `PORTAL_API_ACCESS_TOKEN_NOT_CONFIGURED`

Production Portal credential is absent. Safe startup may still operate while intake is disabled.

### `PROXY_CONFIG_NOT_FOUND`

Create private proxy configuration at `config/proxies.json`. Do not commit it.

### `PROXY_HEALTH_CHECK_NOT_CONFIGURED`

Configure a valid network health-check URL before destructive intake.

### `NO_ENABLED_PROXIES`

At least one valid proxy must have `"enabled": true`.

### `NO_HEALTHY_PROXY_CAPACITY`

Resolve network/proxy health rather than bypassing readiness.

### Manual challenge

Preserve the current process, original session/context/IP, and use only the explicit same-process resume boundary.

Do not restart expecting the challenge session to be reconstructable.

### Final result becomes `UNCERTAIN`

Do not resend blindly. The current verified Portal result contract does not declare remote idempotent replay support.

### Node engine mismatch

Confirm:

```powershell
node --version
node -p "require('./package.json').engines.node"
```

Node must satisfy `>=22.0.0`.

## Known Limitations

The current release intentionally has the following limitations:

- IVAC workflow is bounded to verified authentication only.
- No verified payment workflow is implemented.
- No verified IVAC application-submission workflow is implemented.
- No automatic CAPTCHA or human-verification solving exists.
- Manual challenge resume requires the same running process.
- Manual challenge restart recovery is unsupported.
- Cookies and session state are not durable.
- Sensitive workflow execution input is not durable.
- OTP state is not durable.
- PDF buffers are not durable.
- Workflow response cache is not durable.
- Dashboard is read-only and loopback-only.
- No trusted external manual-challenge mutation/control plane exists.
- Remote Portal final-result idempotent replay is not verified.
- Uncertain non-idempotent operations are deliberately not replayed blindly.
- Phase 34 E2E validation is non-destructive and does not claim a real production IVAC mutation test.

These are deliberate safety boundaries rather than features that should be silently bypassed.

## Release Checklist

Before a release checkpoint:

```powershell
npm run check
npm test
npm audit --omit=dev
npm install-scripts ls
npm start
git diff --check
git status --short
```

Before commit:

```powershell
git diff --cached --check
git diff --cached --stat
git diff --cached --name-only
```

After push:

```powershell
git status --short
git rev-parse HEAD
git rev-parse origin/master
```

Local HEAD and `origin/master` must match.

## Deployment Status

Production activation should occur only after the operator has supplied the required environment, proxy, Portal, target-contract, and operational prerequisites and has independently confirmed that the intended use is authorized.
