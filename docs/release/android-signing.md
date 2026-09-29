# AngelaNexus Android Release Signing

## Release identity

- Application ID: `app.angelanexus`
- Current versionCode: `1`
- Current versionName: `0.1.0`
- Release signing is mandatory for `assembleRelease`.
- Release private keys are never stored in the repository.

## Required GitHub Actions secrets

Configure these repository secrets before running the Android release workflow:

- `ANGELANEXUS_RELEASE_KEYSTORE_B64`: Base64-encoded PKCS12/JKS release keystore
- `ANGELANEXUS_RELEASE_KEYSTORE_PASSWORD`: keystore password
- `ANGELANEXUS_RELEASE_KEY_ALIAS`: release key alias
- `ANGELANEXUS_RELEASE_KEY_PASSWORD`: release key password

The workflow injects these only at build time. The keystore is reconstructed under the Gradle build directory and is not committed.

## Generate the production keystore

Run locally on a trusted machine:

```bash
keytool -genkeypair \
  -v \
  -storetype PKCS12 \
  -keystore AngelaNexus-release.keystore \
  -alias angelanexus-release \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000
```

Use a unique, strong keystore password and key password. Keep the keystore and passwords in an offline/encrypted backup.

Generate the GitHub secret value:

```bash
base64 -w 0 AngelaNexus-release.keystore
```

On macOS:

```bash
base64 < AngelaNexus-release.keystore | tr -d '\n'
```

Store that output as `ANGELANEXUS_RELEASE_KEYSTORE_B64`.

## Important

- Never commit `*.keystore`, `*.jks`, signing passwords, or release private keys.
- Never print signing secrets in CI logs.
- Do not reuse debug signing material for production.
- The production keystore must be backed up before the first public release.
- Losing the production signing key can prevent future updates under the same Android application identity.

## Release workflow

The repository contains:

`/.github/workflows/android-release.yml`

It is manual-only and will:

1. Verify all four signing secrets exist.
2. Build the signed release APK.
3. Verify the APK signature with `apksigner`.
4. Upload the signed APK as a workflow artifact.

The workflow intentionally does not contain any private certificate material.
