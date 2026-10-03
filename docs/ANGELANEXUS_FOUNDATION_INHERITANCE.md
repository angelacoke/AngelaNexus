# AngelaNexus Foundation Inheritance

## Purpose

This document defines the machine-verifiable inheritance model for the **AngelaNexus 纲领之基**.

The inheritance model does not make a local manifest a trust root. It establishes a deterministic lineage record that can be checked by an independent verifier and, later, an external Foundation Anchor.

## Root identity

The current root project is:

- Repository: `angelacoke/AngelaNexus`
- Foundation: `docs/ANGELANEXUS_FOUNDATION.md`
- Foundation Git blob: `4f047d7a53ef7db1d18174916ea9ed5cacbd8133`
- Foundation DNA ID: `da14d8750b5f8af9a41902b752dca6dcc8930bb866fdbc44b493c2a646e22c8e`

The root project has no parent. A descendant project must explicitly identify its parent and carry the same Foundation root and DNA identity.

## Inheritance rule

Fork, migration, rename, split, reorganization, or change of maintainer does not terminate inheritance.

For a descendant:

```
Parent Repository
      ↓
Parent Foundation Blob
      ↓
Parent Foundation DNA
      ↓
Current Repository
      ↓
Current Foundation Inheritance Gate
```

The following fields are mandatory for descendants:

- `parent_repository`
- `parent_foundation_blob_sha`
- `parent_dna_id`
- `root_repository`

The verifier fails closed when these values are absent, malformed, or inconsistent.

## Trust boundary

The local inheritance manifest is evidence, not the ultimate trust root.

Therefore:

```
External Foundation Anchor
        ↓
Foundation Root
        ↓
Foundation DNA
        ↓
Inheritance Manifest
        ↓
Foundation Inheritance Gate
        ↓
Foundation Gate
```

Until an independent external anchor is configured, the repository can prove local consistency but cannot claim an independently anchored lineage.

## No self-issued exemption

No actor may obtain an exemption by changing:

- repository ownership;
- repository name;
- branch structure;
- package or application identity;
- documentation location;
- implementation language;
- execution backend;
- project organization.

A Fork may change implementation. It may not use the Fork relationship to redefine or bypass the Foundation.

## Required gate semantics

The inheritance verifier must:

1. verify the immutable Foundation Git blob;
2. verify the Foundation DNA identity;
3. verify the declared lineage role;
4. require a parent for every non-root lineage role;
5. require the parent to carry the established Foundation blob and DNA identity;
6. fail closed on missing or contradictory lineage evidence;
7. explicitly report that external anchoring is still required for strong identity.

Passing this gate is not governance approval and does not replace human review, security validation, or GitHub merge protection.

## Constitutional relationship

This mechanism implements the constitutional requirements that the Foundation is the highest root principle, that **Fork does not constitute an exemption**, and that every actor in the AngelaNexus inheritance chain remains subject to the Foundation.

The hierarchy remains:

```
纲领之基
   ↓
宪级纲领
   ↓
Foundation DNA
   ↓
Inheritance / Governance Gates
   ↓
Architecture
   ↓
Implementation
```

The machine-readable mechanism is subordinate to the Foundation. It must never become a mechanism for weakening or replacing the Foundation.
