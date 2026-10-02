# Runtime Artifact Compliance

AngelaNexus treats a runtime artifact as a separately verifiable release input.

The artifact record binds:
- kernel and exact upstream version/commit;
- target platform and ABI;
- SHA-256 digest;
- authoritative source location;
- declared license;
- linkage model: embedded, IPC, or process;
- source availability;
- provenance verification;
- license/distribution review;
- final verification state.

A native runtime is not release-ready merely because a native factory exists. Native activation must have a verified artifact record and must fail closed when verification, provenance, source availability, or license review is incomplete.

This record is an engineering/compliance control and is not legal advice.