<p align="center">
  <img src="assets/brand/angelanexus-logo.svg" alt="AngelaNexus logo" width="190">
</p>

<h1 align="center">AngelaNexus</h1>

<p align="center">智能化全能代理系统</p>

AngelaNexus is the unified proxy-system project for Mihomo, sing-box, and Xray adapters.

## Project identity

The four-quadrant cross mark in `assets/brand/angelanexus-logo.svg` is the official project logo. The square variant in `assets/brand/angelanexus-app-icon.svg` is the canonical app-icon asset for platform clients.

## Current implementation status

- Platform-neutral core: active development with automated unit and three-kernel conformance verification.
- Android: real application module baseline is present under `native/android/app`.
- Android VPN: native `VpnService` boundary is wired into the application shell.
- Android configuration import: document-picker entry point is present; core import integration remains the next milestone.
- Mihomo / sing-box / Xray Android runtime embedding: not yet claimed as production-ready.

See [`docs/APP_PROGRESS.md`](docs/APP_PROGRESS.md) for the evidence-based APP status and next milestones.
