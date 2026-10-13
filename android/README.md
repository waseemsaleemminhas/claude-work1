# Ironclad Ledger — the Android app

The company book on a phone, built to work with no signal. Every entry is written
to the phone first and syncs to the shared sheet on its own when there is a
network. Nobody ever waits for a spinner to record a cost.

## What it does today

- **Tap, type, done.** Tap a category, punch the amount into the keypad, Add. The
  campaign is already filled in — a category either carries a sharing rule
  (electricity, rent and the rest go out by seats) or takes the person's own
  default.
- **Line items.** One receipt can be five headsets and two keyboards on different
  categories, and still be one payment.
- **Mandatory campaign allocation.** Every line is split to the last paisa,
  largest remainder with ties broken on campaign name — the same arithmetic as the
  sheet and the web page, so no two devices ever disagree. A rule is worked out
  once and frozen into the entry; last month's report does not move when seat
  counts change.
- **Drafts.** A line that cannot be allocated yet still saves: the money really
  left the account. It waits in a "Needs a campaign" queue that wants to be empty.
- **Works offline, syncs when it can.** Room on the phone is the source of truth.
  WorkManager pushes what is unsent and pulls what changed, whenever there is a
  network. With no server link set at all, it is simply a ledger on that phone.
- Records, a by-campaign report, floats (cash someone is carrying), and adding a
  category mid-entry.

Not built yet: the home-screen widget, editing campaigns and accounts from the app
(do that on the sheet for now), and receipt photos.

## Getting the APK

**The free way, no Android SDK on anyone's machine.** Push a tag and GitHub
Actions builds it and attaches it to a Release:

    git tag v0.1.0 && git push origin v0.1.0

The workflow is `.github/workflows/android.yml`. It also builds on every push to
`main` that touches `android/`, leaving the APK as a downloadable artifact.

**Building it yourself** needs a JDK 17+ and the Android SDK (platform 35,
build-tools 35.0.0):

    cd android
    ./gradlew testDebugUnitTest     # the allocation engine and the wire contract
    ./gradlew assembleRelease       # app/build/outputs/apk/release/app-release.apk

## Signing — do this before you hand the APK to anyone

Until you add a key the build signs with Android's debug key. That installs fine,
but every build must be signed with the **same** key or Android refuses to install
the new one over the old. Make the key once, back it up in three places, and never
commit it:

    keytool -genkey -v -keystore ledger-release.jks -keyalg RSA \
      -keysize 2048 -validity 10000 -alias ledger

Then put `android/keystore.properties` beside the project (git ignores it):

    storeFile=ledger-release.jks
    storePassword=…
    keyAlias=ledger
    keyPassword=…

## Connecting it to the shared book

1. Deploy `Ledger.gs` as a web app with **Who has access: Anyone**. The app
   authenticates with its access code, not a Google account, so the stricter
   setting locks it out.
2. In the app: Settings → paste the web app link and the person's access code from
   the sheet's People tab.
3. Tap Sync now. After that it syncs by itself whenever an entry is added and
   there is a network.

Leave the link empty and the app never talks to anything — a private ledger on one
phone.

**Worth knowing:** with "Anyone", the link plus a code is what gets someone in.
Give each person their own code, keep the link out of group chats, and change a
code the day somebody leaves. If that is not good enough for you, the upgrade is
Google Sign-In in the app with the ID token checked against the People tab — the
data model does not change.

## How it is put together

    data/Model.kt       the words and shapes: Entry, Line, Allocation, Campaign…
    data/Allocator.kt   the split engine — the one piece that must match the server
    data/Db.kt          Room: the ledger on this phone
    data/Seed.kt        the BPO chart of accounts a new ledger starts with
    data/Repo.kt        every read and write, with no network in the way
    data/Sync.kt        push what is unsent, pull what changed
    Vm.kt               screen state, the keypad calculator, the voucher being filled in
    ui/                 Compose screens

Amounts are whole paisa (`Long`) everywhere and only become words at the edge.
Entries point at categories, campaigns and accounts **by name**, exactly as the
sheet does, so the two sides can be reconciled by eye.

## Tests

    ./gradlew testDebugUnitTest

- `AllocatorTest` — the split engine: thirds of a rupee, awkward amounts, the
  tie-break that keeps two phones agreeing, by-seats and by-agents sharing, closed
  and internal campaigns taking no share.
- `SyncContractTest` — parses a reply captured from the real Apps Script code, so
  the two halves are checked against what the server actually sends.
