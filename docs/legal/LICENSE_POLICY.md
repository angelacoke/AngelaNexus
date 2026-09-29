# AngelaNexus License Policy

## Scope

This policy defines how licensing is applied to AngelaNexus source code, documentation, assets, dependencies, and integrated third-party runtimes.

## Project code

Unless a file or directory states otherwise, original AngelaNexus source code is intended to be licensed under Apache License 2.0. The canonical license text is the repository-root LICENSE file.

SPDX identifier: Apache-2.0.

## Third-party components

A third-party component is not relicensed merely because it is included in an AngelaNexus distribution. Its original copyright, license, attribution, NOTICE, and redistribution conditions must be preserved as applicable.

This applies in particular to the planned Mihomo, sing-box, and Xray runtime integrations. Their exact license obligations must be recorded against the exact upstream revision actually distributed.

## Generated and configuration material

Generated files inherit the applicable source component's license unless a file explicitly declares another license. User-provided proxy configurations, subscriptions, rules, and imported data are not automatically relicensed by AngelaNexus.

## Brand assets

The AngelaNexus name, logo, and app icon are project brand assets. Apache-2.0 licensing of source code does not by itself grant unrestricted trademark rights in those identifiers.

## Release requirement

A release must not be published until the dependency inventory, third-party notices, and license obligations for the exact shipped artifacts have been verified.

## Change control

Any new dependency, embedded runtime, copied source, generated vendor tree, or redistributed binary must be reviewed for licensing before release.
