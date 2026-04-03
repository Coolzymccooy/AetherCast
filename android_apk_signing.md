# Android APK Signing — Mandatory

Stop before any Android build, signing change, or release packaging work.

## Non-Negotiable Rule

Every future APK must be signed with the same keystore:

- File: `android/app/aethercast-release.keystore`
- Alias: `aethercast`
- Password: `aethercast123`
- Validity: 10,000 days

If this keystore changes, existing users will have to uninstall the app before upgrading.

## Required Handling

- Do not replace, rotate, or rename the release keystore without explicit user approval.
- Keep a backup copy of `aethercast-release.keystore` outside the repo.
- Before changing Android signing, `build.gradle`, Capacitor Android config, or release packaging, read `CLAUDE.md` and this file first.

## Local SDK Reminder

If Android builds fail because the SDK path is missing, create `android/local.properties` with:

```properties
sdk.dir=C\:\\Users\\segun\\AppData\\Local\\Android\\Sdk
```

## Release Build Sequence

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../public/downloads/aethercast-camera.apk
```

Web-only React changes do not require a new APK.
Native Java/plugin, manifest, Gradle, or Capacitor config changes do require a rebuild.
