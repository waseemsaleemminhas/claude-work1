# The signing key

Every APK handed to anybody must be signed with the same key. Android only lets
an app update in place when the signature matches, so a build signed with a
different key cannot install over the last one: the phone refuses it, and the
only way through is to uninstall first, which **wipes everything on that phone
that has not synced to the sheet**.

The key is `ironclad-release.jks`, made once on 13 October 2026, valid until
2056. It is not in git and must never be.

    Alias        ironclad
    SHA-256      FF:EC:82:BD:E6:B1:CD:BC:F8:59:F4:3D:FE:D3:8F:D7:
                 FC:4D:CA:07:FC:DD:2B:68:2D:17:6B:50:1F:39:76:48

Check any APK against that fingerprint before sending it round:

    $ANDROID_HOME/build-tools/35.0.0/apksigner verify --print-certs app-release.apk

## Where it lives

- Two copies kept by the company: one in Google Drive, one offline.
- Four GitHub repository secrets, which is how CI signs:
  `KEYSTORE_BASE64` (the file, `base64 -w0`), `KEYSTORE_PASSWORD`,
  `KEY_ALIAS`, `KEY_PASSWORD`.

**Lose it and there is no recovery.** Every phone would have to uninstall and
reinstall, losing anything not yet synced, and a Play Store listing made with
the old key could never be updated again.

## Building a signed APK by hand

Put a `keystore.properties` next to this file (it is gitignored):

    storeFile=ironclad-release.jks
    storePassword=…
    keyAlias=ironclad
    keyPassword=…

Then `./gradlew assembleRelease`. Without that file the build still works but
falls back to a throwaway debug key — fine for trying something out on your own
phone, never for handing round.

## Releasing

    git tag v0.4.0 && git push --tags

CI runs the tests, builds, prints the fingerprint it signed with, and attaches
`ironclad-ledger-0.4.0.apk` to the GitHub release. A tagged build with no key
secrets fails on purpose rather than quietly producing something nobody can
install over their current copy.

Bump `versionCode` for every build that leaves the building. Same package, same
key, higher `versionCode` means it installs over the top and keeps the data.
