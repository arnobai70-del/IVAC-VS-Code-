# IVAC Automation Platform

Production-oriented Node.js automation platform built around:

- isolated per-job state
- exclusive IP ownership
- durable job state
- controlled retries
- isolated network sessions
- OTP isolation
- JSON-driven workflows
- document handling
- idempotent result reporting
- operational dashboard
- restart recovery
- graceful shutdown

## Current Development Status

Phase 1 is the current implemented phase.

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

Not implemented yet:

- SQLite persistence
- jobs
- state machine
- IP allocation
- proxy dispatchers
- Portal integration
- OTP integration
- workflow execution
- document handling
- result reporting
- dashboard
- shutdown/recovery orchestration

These will be added phase by phase.

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