# AngelaNexus Foundation Gate

This document defines the machine-enforced eligibility gate for every proposed change.

## Non-negotiable rule

No person, role, automation, bot, AI agent, administrator, repository owner, maintainer, contributor, fork maintainer, successor, or migration owner is exempt from this gate.

A PASS is only an eligibility result. It is not governance approval and never replaces required human review or repository protection.

## Trust boundary

The immutable foundation baseline is the Git object identity recorded in the gate workflow. The workflow checks the repository Git object rather than trusting a value supplied by the changed foundation file itself.

Baseline foundation Git blob SHA: `4f047d7a53ef7db1d18174916ea9ed5cacbd8133`

The gate workflow and its baseline are themselves governance-protected files. Their effective protection depends on GitHub Ruleset / branch protection and Code Owners configuration.
