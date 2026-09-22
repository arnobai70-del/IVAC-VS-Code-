# IVAC Automation Platform

Production-oriented Node.js automation platform built around:

- isolated per-job state
- exclusive IP ownership
- durable SQLite job state
- controlled bounded retries
- isolated per-job network sessions
- OTP isolation
- safe JSON-driven workflows
- secure PDF document handling
- idempotent final-result reporting
- read-only operational dashboard
- restart recovery
- graceful shutdown
- explicit manual-challenge handling
- same-process workflow resume without replaying completed steps

## Current Development Status

Phase 15 is complete.

Current implementation is intentionally fail-closed and non-destructive by default.

Portal intake is disabled by default, workflow execution is disabled by default, and destructive runtime activation requires verified integration configuration.

## Completed Phases

### Phase 1 — Foundation

Implemented:

- Node.js project scaffold
- validated static configuration
- `.env.local` secret loading
- structured application errors
- structured logging
- sensitive-field log redaction
- configuration tests
- logging tests
- error tests

### Phase 2 — SQLite / Durable Job State

Implemented:

- SQLite persistence
- migrations
- durable jobs
- job lifecycle state machine
- optimistic job versioning
- retry counters
- terminal job handling
- restart-visible non-terminal jobs

### Phase 3 — Proxy / IP Allocation

Implemented:

- proxy configuration
- proxy pool
- health/cooldown state
- exclusive job-to-IP allocation
- one active job per IP
- same-job IP preservation across retry
- allocation-safe dispatcher isolation
- terminal-only IP release

### Phase 4 — Safe Portal Intake

Implemented:

- Portal pending intake client
- Portal application mapping
- capacity calculation before destructive intake
- intake reservation tracking
- duplicate application protection
- assigned IP propagation through `Server-Name`
- fail-closed Portal readiness
- non-enumerable memory-only execution handoff

Sensitive Portal execution input is not persisted.

### Phase 5 — Per-Job Session / Client Isolation

Implemented:

- per-job session manager
- isolated CookieJar
- isolated dispatcher
- allocation-bound HTTP client
- same-job session reuse
- no direct-network fallback
- blocked unsafe workflow headers
- closed-session protection

Sessions and cookies are intentionally memory-only.

### Phase 6 — OTP HTML Table Integration

Implemented:

- OTP HTML table client
- header-based table parsing
- Bangladesh phone normalization
- OTP baseline capture
- exact-phone matching
- timeout handling
- per-job OTP isolation
- anti-bot/manual-challenge detection
- same-job HTTP client reuse

OTP values are not logged or persisted as durable recovery data.

### Phase 7 — Safe JSON Workflow Engine

Implemented:

- validated JSON workflow definitions
- bounded workflow step count
- safe template resolution
- no `eval`
- prototype-access protection
- relative target routes only
- target HTTP execution
- OTP workflow hooks
- manual-challenge propagation
- fail-closed workflow validation

### Phase 8 — Portal PDF Document Pipeline

Implemented:

- Portal PDF download
- allowlisted source origins
- same-job HTTP client reuse
- PDF Content-Type validation
- PDF signature validation
- bounded document count
- per-file size limit
- total size limit
- duplicate PDF protection
- memory-only document buffers
- multipart upload
- anti-bot/manual-challenge propagation
- no temporary PDF files on disk

### Phase 9 — Final Result Capture / Idempotent Finalization

Implemented:

- durable final-result ledger
- deterministic idempotency keys
- safe result normalization
- sensitive-field rejection
- binary/PDF payload rejection
- duplicate-send protection
- durable delivery state
- uncertain-delivery protection
- terminal transition only after verified acknowledgement
- terminal IP release
- failure finalization

Unverified remote result replay is never performed blindly.

### Phase 10 — Read-Only Operational Dashboard API

Implemented:

- health endpoint
- overview endpoint
- job list/detail
- proxy status
- live allocation status
- capacity status
- readiness status
- sensitive-field redaction
- bounded operational errors
- loopback-only binding
- GET-only API
- no mutation endpoints

The dashboard remains strictly read-only.

### Phase 11 — Restart Recovery + Graceful Shutdown

Implemented:

- durable recovery metadata
- interrupted job classification
- bounded recovery decisions
- same-IP reservation preservation
- no automatic manual-challenge resume
- no blind document-upload replay
- stale final-result delivery protection
- graceful intake shutdown
- workflow abort propagation
- bounded shutdown wait
- session cleanup
- dispatcher cleanup
- terminal-only IP release preservation

Sessions, cookies, Portal credentials, and execution input are not restart-recoverable.

### Phase 12 — Guarded Portal Intake Runtime

Implemented:

- sequential Portal polling loop
- no overlapping destructive intake cycles
- configurable polling interval
- intake disabled by default
- no blind destructive intake retry
- graceful stop behavior
- active-cycle wait
- safe downstream cycle callback handling

### Phase 13 — Intake-to-Workflow Runtime Execution

Implemented:

- intake execution handoff
- per-job workflow execution worker
- same allocation/IP execution
- same session across target, OTP, and document work
- workflow client construction
- document service runtime integration
- execution/finalization separation
- memory-only sensitive execution input

No replacement IP is acquired during workflow execution.

### Phase 14 — Bounded Runtime Workflow Retry

Implemented:

- explicit retry classification
- durable retry counter
- bounded retry limit
- bounded retry delays
- same-IP retry reservation
- `RUNNING -> RETRY_PENDING -> RUNNING`
- manual challenge excluded from automatic retry
- shutdown excluded from retry budget
- unknown errors fail closed
- final-result delivery kept outside workflow retry boundary
- retry exhaustion converted to explicit terminal execution failure

Default retry limit:

- maximum retries: `3`
- retry delays: `1000 ms`, `5000 ms`, `15000 ms`

### Phase 15 — Safe Manual Challenge Resume Lifecycle

Implemented:

- explicit `WAITING_FOR_MANUAL_CHALLENGE -> RUNNING` resume path
- no automatic challenge resume
- same-process resume only
- original memory-only JobContext required
- original session required
- same IP/allocation required
- no replacement IP
- no new session creation during manual resume
- restart fails closed when in-memory context is unavailable
- manual challenge does not consume retry budget
- repeated challenge remains manual
- retryable error after explicit resume may enter normal bounded retry
- completed workflow steps are not replayed
- completed HTTP/OTP/document-prepare steps are skipped
- partially completed document uploads are reused
- non-contiguous resume state fails closed
- same-job concurrent execution protection
- manual resume participates in graceful shutdown
- finalization remains outside workflow retry boundary
- dashboard remains read-only
- no external mutation/control endpoint has been invented

## Current Runtime Safety Model

### One IP = One Active Job

A live IP allocation belongs to one active job.

Retries and same-process manual resume must retain the same allocation.

A replacement IP is not silently acquired.

### Terminal-Only IP Release

Non-terminal conditions do not release the assigned IP.

This includes:

- retryable failures
- manual challenge
- graceful shutdown
- interrupted execution
- final-result delivery uncertainty

IP release happens only after terminal lifecycle handling.

### Manual Challenges

Anti-bot or human-verification responses are never bypassed.

They produce:

`MANUAL_CHALLENGE_REQUIRED`

Automatic retry is disabled for this condition.

Explicit resume requires the original live in-memory execution context, session, and IP.

Manual challenge resume is not restart-recoverable.

### Restart Boundary

Durable across restart:

- job state
- retry count
- IP allocation metadata
- recovery metadata
- final-result ledger

Not durable across restart:

- Portal password
- sensitive execution input
- session cookies
- HTTP session state
- OTP state
- PDF buffers
- same-process workflow response cache

The runtime does not claim these memory-only resources can be reconstructed.

### Workflow Resume

Within the same process, completed workflow steps are recorded in the per-job memory context.

On retry or explicit manual resume:

- completed prefix steps are skipped
- first incomplete step is attempted
- inconsistent/non-contiguous completion state fails closed
- completed document uploads may be reused through per-document upload markers

No durable restart workflow replay guarantee is claimed.

## Safe Default Configuration

By default:

- Portal intake is disabled
- workflow execution is disabled
- dashboard is disabled
- Portal result contract is unconfigured
- Portal health route is unconfigured
- proxy configuration may be absent
- no destructive Portal polling occurs

Destructive intake cannot be enabled unless:

1. workflow execution is enabled
2. the verified Portal final-result contract is configured

## Operational Dashboard

The operational dashboard is designed for observability only.

Properties:

- read-only
- loopback-only
- no mutation routes
- redacted output
- bounded error output

Manual challenge resume is not exposed through the dashboard.

## Sensitive Data Rules

The application must not log or durably persist:

- passwords
- secrets
- API tokens
- authorization headers
- cookies
- OTP values
- raw PDF binary
- full sensitive Portal payloads

Sensitive runtime execution input remains memory-only.

## Validation

Current Phase 15 verification:

- `npm run check` — passed
- `npm test` — passed
- tests: `291`
- passed: `291`
- failed: `0`
- `npm start` — passed
- bootstrap reports Phase `15`
- `git diff --check` — clean
- `git diff --cached --check` — clean
- staged secret-pattern scan — clean

## Requirements

- Windows
- PowerShell
- Node.js 20+
- npm
- Git

Check versions:

```powershell
node --version
npm --version
git --version