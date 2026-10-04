# AngelaNexus External Foundation Anchor

## Purpose

The external anchor is an optional independent evidence layer below the Foundation's authority and alongside repository-local verification.

It exists to provide additional independently retrievable evidence when desired. It does not become the project's root principle or a prerequisite for ordinary Foundation inheritance.

## Current state

The anchor record is intentionally marked `pending_external_publication`.

No external anchor repository, signing authority, DNS record, transparency log, or other independent publication point is claimed to exist until it is actually created and independently verified.

Therefore this repository currently proves:

1. the canonical Foundation identity;
2. the canonical Foundation DNA;
3. the canonical anchor payload;
4. the required format for an independent anchor.

It does not claim that an external anchor is active. This does not invalidate Foundation Gene inheritance.

## Canonical identity

- Root repository: `angelacoke/AngelaNexus`
- Foundation blob: `4f047d7a53ef7db1d18174916ea9ed5cacbd8133`
- Foundation DNA ID: `da14d8750b5f8af9a41902b752dca6dcc8930bb866fdbc44b493c2a646e22c8e`
- Canonical payload SHA-256: `1f69492e1bd9e5771faf218bc822081e369c5b5b5dcd66a5def4e5570fba690e`

## Required external anchor properties

If activated, an external anchor must:

- exist outside the AngelaNexus repository's normal write path;
- publish the exact canonical payload;
- preserve the payload byte-for-byte;
- expose an independently verifiable identity or signature;
- be independently retrievable;
- never authorize an exemption from the 纲领之基;
- remain subordinate to the Foundation itself.

Possible publication mechanisms include an independently controlled repository, signed release artifact, transparency log, DNSSEC-backed record, or another independently governed public trust system. Selection is an implementation decision; the trust property is not negotiable.

## Fail-closed rule

If an external anchor is declared active, verification must fail when:

- the external payload differs;
- the Foundation blob differs;
- the DNA ID differs;
- the signature is invalid;
- the anchor cannot be independently retrieved;
- the declared external source is silently changed.

A missing external anchor is represented as **pending**, not falsely reported as **verified**.

## Constitutional position

The external anchor does not become a new supreme authority. It only independently preserves evidence of the Foundation identity.

Hierarchy remains:

`纲领之基 → 宪级纲领 → Foundation DNA / Gene → 继承验证 → 架构 → 实现`

外部锚定证据是可选的独立旁证，不是层级上的新权威。

The external anchor can prove what the Foundation identity was; it cannot redefine why AngelaNexus exists.
