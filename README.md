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
- fail-closed workflow runtime activation
- safe final-result restart recovery

## Current Development Status

Phase 26 is complete.

Latest functional checkpoint before Phase 26 synchronization:

`bbc03e1 feat: harden runtime status contract`

Current implementation remains intentionally fail-closed and non-destructive by default.

Portal intake is disabled by default, workflow execution is disabled by default, the workflow definition is disabled by default, the dashboard is disabled by default, and externally verified runtime activation remains explicit.

Phases 19 through 25 added the IVAC workflow policy boundary, IVAC target contract boundary and runtime enforcement, workflow readiness inspection, runtime dashboard status bridging, and strict runtime-status contract hardening.

Phase 26 synchronizes the project checkpoint documentation and bootstrap phase marker with the implemented repository state.

No Phase 26 change adds a mutation endpoint, bypasses a manual challenge, persists sensitive runtime context, or weakens existing fail-closed execution boundaries.

## Completed Phases

### Phase 1 â€” Foundation

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

### Phase 2 â€” SQLite / Durable Job State

Implemented:

- SQLite persistence
- migrations
- durable jobs
- job lifecycle state machine
- optimistic job versioning
- retry counters
- terminal job handling
- restart-visible non-terminal jobs

### Phase 3 â€” Proxy / IP Allocation

Implemented:

- proxy configuration
- proxy pool
- health/cooldown state
- exclusive job-to-IP allocation
- one active job per IP
- same-job IP preservation across retry
- allocation-safe dispatcher isolation
- terminal-only IP release

### Phase 4 â€” Safe Portal Intake

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

### Phase 5 â€” Per-Job Session / Client Isolation

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

### Phase 6 â€” OTP HTML Table Integration

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

### Phase 7 â€” Safe JSON Workflow Engine

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

### Phase 8 â€” Portal PDF Document Pipeline

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

### Phase 9 â€” Final Result Capture / Idempotent Finalization

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

### Phase 10 â€” Read-Only Operational Dashboard API

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

### Phase 11 â€” Restart Recovery + Graceful Shutdown

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

### Phase 12 â€” Guarded Portal Intake Runtime

Implemented:

- sequential Portal polling loop
- no overlapping destructive intake cycles
- configurable polling interval
- intake disabled by default
- no blind destructive intake retry
- graceful stop behavior
- active-cycle wait
- safe downstream cycle callback handling

### Phase 13 â€” Intake-to-Workflow Runtime Execution

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

### Phase 14 â€” Bounded Runtime Workflow Retry

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

### Phase 15 â€” Safe Manual Challenge Resume Lifecycle

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

### Phase 16 â€” Fail-Closed Workflow Runtime Gate

Implemented:

- destructive Portal intake requires workflow runtime activation
- destructive Portal intake requires an enabled workflow definition
- destructive Portal intake requires a configured Portal final-result contract
- runtime gate is checked before destructive intake activation
- default startup remains non-destructive
- missing verified external contracts fail closed
- no Portal endpoint or acknowledgement semantics are invented
- workflow runtime and workflow-definition activation remain explicit
- dashboard remains read-only
- existing workflow and finalization safety boundaries are preserved

### Phase 17 â€” Safe Final-Result Restart Recovery

Implemented:

- `FinalResultService.resumeDelivery(jobId)`
- durable `PENDING` final results can resume without reconstructing the result payload
- `UNCERTAIN` delivery cannot replay without verified remote idempotency
- `PENDING` records with previous `UNCERTAIN` delivery certainty fail closed without verified remote idempotency
- stale `IN_FLIGHT` recovery remains `UNCERTAIN`
- final-result recovery remains outside the workflow retry boundary
- workflow steps are never replayed because of result-delivery recovery
- workflow retry budget is not consumed by final-result recovery
- same live IP is required while final-result delivery is pending
- IP releases only after verified delivery and terminal transition
- `FinalResultRecoveryRunner`
- restart recovery classification is separated from result-delivery orchestration
- unconfigured Portal result contract safely skips recovery delivery
- one result-delivery recovery failure does not stop processing other recovery records
- bootstrap reports Phase 17
- default configuration remains fail-closed

New Phase 17 files:

- `src/runtime/final-result-recovery-runner.js`
- `tests/final-result-recovery-runner.test.js`
- `tests/final-result-recovery.test.js`

Modified Phase 17 files:

- `src/results/final-result-service.js`
- `src/index.js`
- `tests/final-result-service.test.js`
- `package.json`


### Phase 18 - Verified Portal Runtime Contract Integration

Implemented:

- verified Portal health contract integration
- authenticated Portal readiness validation through:
  - `GET /api/novaflow/v1/ping`
- verified Portal pending intake contract boundary:
  - `GET /api/application/pending`
- static Portal worker identity support through `Server-Name`
- separation between Portal worker identity and per-job proxy/IP allocation
- verified Portal final-result HTTP contract:
  - `POST /api/application/{application}/status`
- numeric Portal Application ID enforcement for final-result delivery
- environment-only Portal API token usage
- minimum safe final-result payload mapping
- strong acknowledgement validation before terminal transition
- explicit remote idempotent replay capability:
  - `false`
- conservative delivery certainty handling
- preservation of existing final-result restart recovery boundaries
- no workflow replay caused by final-result delivery recovery
- no workflow retry budget consumption from final-result delivery recovery

Phase 18 safety boundaries:

- Portal final-result contract remains explicitly opt-in
- default runtime remains non-destructive
- no OTP forwarding
- no password/token/cookie forwarding
- no raw workflow payload forwarding
- no PDF binary forwarding
- no invented remote idempotency semantics
- no trusted manual-challenge control plane integration

New Phase 18 files:

- `src/portal/portal-result-http-contract.js`
- `tests/portal-result-http-contract.test.js`

Modified Phase 18 files:

- `config/app.json`
- `package.json`
- `src/config/schema.js`
- `src/config/loader.js`
- `src/index.js`
- `src/portal/portal-client.js`
- `src/portal/portal-intake-service.js`
- `tests/portal-client.test.js`
- `tests/portal-intake-service.test.js`
- `tests/portal-intake-execution-handoff.test.js`

### Phase 19 - IVAC Workflow Policy Layer

Implemented:

- explicit IVAC workflow policy validation
- allowlisted workflow step types:
  - `http`
  - `otp.prepare`
  - `otp.wait`
  - `documents.prepare`
  - `documents.upload`
- unsupported workflow step types fail closed
- forbidden automation patterns fail closed
- workflow loader applies IVAC policy validation
- workflow capabilities expose bounded safety metadata
- automatic challenge bypass remains disabled
- credential, OTP, and cookie persistence remain disabled

### Phase 20 - IVAC Target Contract Boundary

Implemented:

- explicit IVAC target contract model
- unverified contract defaults fail closed
- verified endpoint metadata normalization
- relative endpoint-path validation
- endpoint method normalization
- bounded target-contract operational summary
- no target endpoint is assumed verified by default

### Phase 21 - IVAC Target Contract Metadata Hardening

Implemented:

- target contract objects are frozen
- endpoint collections are frozen
- contract metadata cannot be silently mutated after construction
- IVAC target contract source is included in project syntax checks
- unverified contract behavior remains fail closed

### Phase 22 - IVAC Target Contract Runtime Enforcement

Implemented:

- IVAC target contract is enforced at the workflow runtime boundary
- target HTTP execution receives verified contract metadata
- job workflow client construction carries the target contract
- job workflow executor carries the target contract
- target requests remain bound to the existing per-job HTTP client
- absolute external target routes remain blocked
- unsafe workflow headers remain blocked
- anti-bot or human-verification responses still require manual handling

### Phase 23 - Workflow Readiness Inspection

Implemented:

- `inspectWorkflowReadiness()`
- workflow enabled-state inspection
- bounded workflow step count reporting
- normalized workflow step-type reporting
- execution-readiness reporting
- explicit readiness safety boundaries:
  - schema validation
  - IVAC policy validation
  - target contract requirement
  - no automatic challenge bypass
  - no credential persistence
  - no OTP persistence
  - no cookie persistence

### Phase 24 - Runtime Execution Status Dashboard Bridge

Implemented:

- `ExecutionWorker.getStatus()` is bridged into the operational dashboard
- runtime-status provider wiring in application bootstrap
- `OperationalService.getRuntimeStatus()`
- read-only `GET /api/dashboard/runtime`
- runtime endpoint rejects non-GET requests
- final dashboard response redaction remains active
- runtime status exposes execution observability without adding mutation control

### Phase 25 - Runtime Status Contract Hardening

Implemented:

- strict runtime-status allowlist
- allowed runtime counters:
  - `inFlight`
  - `memoryContexts`
- counters must be non-negative safe integers
- zero counters are valid
- malformed runtime-provider output fails closed
- unexpected provider fields are discarded
- sensitive provider fields are never exposed through runtime status
- provider errors continue through bounded operational error sanitization

### Phase 26 - Project Checkpoint / Bootstrap Status Synchronization

Implemented:

- bootstrap phase marker synchronized to Phase 26
- returned bootstrap phase synchronized to Phase 26
- project status documentation synchronized through Phase 26
- completed Phase 19-25 work recorded in repository documentation
- current validation count synchronized to 345 tests
- existing runtime behavior and safety boundaries otherwise unchanged

## Current Runtime Safety Model

### One IP = One Active Job

A live IP allocation belongs to one active job.

Retries, same-process manual resume, and pending final-result delivery must retain the same allocation.

A replacement IP is not silently acquired.

### Terminal-Only IP Release

Non-terminal conditions do not release the assigned IP.

This includes:

- retryable failures
- manual challenge
- graceful shutdown
- interrupted execution
- pending final-result delivery
- uncertain final-result delivery

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
- final-result delivery state

Not durable across restart:

- Portal password
- sensitive execution input
- session cookies
- HTTP session state
- OTP state
- PDF buffers
- same-process workflow response cache
- manual-challenge execution context

The runtime does not claim these memory-only resources can be reconstructed.

### Workflow Resume

Within the same process, completed workflow steps are recorded in the per-job memory context.

On retry or explicit manual resume:

- completed prefix steps are skipped
- first incomplete step is attempted
- inconsistent/non-contiguous completion state fails closed
- completed document uploads may be reused through per-document upload markers

No durable restart workflow replay guarantee is claimed.

### Final-Result Recovery

Final-result delivery is outside workflow execution and workflow retry.

Restart recovery may resume only from the existing durable final-result ledger.

Properties:

- result payload is not reconstructed from workflow execution input
- workflow steps are not replayed
- workflow retry budget is not consumed
- same live IP is required
- `PENDING` delivery may resume when replay is safe
- stale `IN_FLIGHT` delivery becomes `UNCERTAIN`
- `UNCERTAIN` delivery is never blindly replayed
- replay after uncertain delivery requires explicitly verified remote idempotency
- terminal job transition requires verified acknowledgement
- IP remains allocated until terminal lifecycle completion

## Safe Default Configuration

By default:

- Portal intake is disabled
- workflow runtime execution is disabled
- workflow definition is disabled
- dashboard is disabled
- Portal final-result contract is unconfigured
- Portal health route is unconfigured
- proxy configuration may be absent
- no destructive Portal polling occurs

Destructive intake cannot be enabled unless:

1. workflow runtime execution is enabled
2. the workflow definition is enabled
3. the verified Portal final-result contract is configured

No final-result endpoint, payload mapping, acknowledgement semantics, or remote idempotency behavior is assumed by default.

## Portal Final-Result Contract Boundary

`PortalResultClient` intentionally accepts an injected verified contract instead of inventing Portal behavior.

Without a configured contract:

- `isConfigured()` is false
- delivery fails closed
- restart delivery is skipped safely
- destructive Portal intake cannot activate

A future verified contract must explicitly define:

- how the result is sent
- what constitutes an accepted acknowledgement
- whether uncertain delivery may be replayed idempotently

The repository does not currently define those external Portal semantics.

## Operational Dashboard

The operational dashboard is designed for observability only.

Properties:

- read-only
- loopback-only
- no mutation routes
- redacted output
- bounded error output

Manual challenge resume is not exposed through the dashboard.

No trusted external mutation/control-plane contract is currently configured.

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

Current Phase 26 verification:

- `npm run check` - passed
- `npm test` - passed
- tests: `345`
- passed: `345`
- failed: `0`
- `npm start` - passed
- bootstrap reports Phase `26`
- `git diff --check` - clean
- runtime-status strict allowlist tests - passed
- invalid runtime counter fail-closed tests - passed
- workflow and target-contract safety tests - passed
- secret/runtime safety boundaries remain enforced

Latest functional checkpoint before Phase 26 synchronization:

`bbc03e1 feat: harden runtime status contract`

## Current External Integration Gates

The verified Portal runtime contract defines the currently known Portal health, pending-intake, and final-result status boundaries.

The following boundaries remain explicitly gated:

- destructive Portal intake remains opt-in
- workflow runtime execution remains opt-in
- the workflow definition remains disabled by default
- IVAC target workflow endpoints require explicit verified target-contract metadata
- unverified target endpoints fail closed
- trusted external manual-challenge control is not configured
- automatic manual-challenge resume is disabled
- manual-challenge restart recovery is unavailable because the required session/context is memory-only
- remote final-result replay after uncertain delivery is not assumed idempotent

No runtime component may invent missing target endpoints, bypass human verification, or reconstruct memory-only credentials, cookies, OTP state, PDF buffers, or workflow execution context after restart.

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
```