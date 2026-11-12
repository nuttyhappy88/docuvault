# DocuVault

Document management for multiple businesses. Everything here builds for free on GitHub.

| Part | What it is | Where people get it |
|---|---|---|
| **DocuVault (Vault)** | The full system: receiving, filing, workflows, reports, users, retention, printing. Works offline. | **Windows:** `DocuVault-Setup-….exe` under **Releases**. **Phones, Macs, any browser:** the GitHub Pages address (see step 3). |
| **DocuVault Go** | Android companion: Google's document scanner (auto crop and straighten), text reading on the phone, suggested filing, send to the Inbox, approve tasks, alerts. | `DocuVault-Go-….apk` under **Releases**. |
| **Server** | Already running on Floot at `https://jainins-server.floot.app` (records), with files in Google Drive. `server/` is the office-computer alternative. | Nothing to install. |

Vault and Go share the same accounts, documents and workflows.

## One-time GitHub setup

1. **Create the repository** on github.com (New repository, e.g. `docuvault`). Choose **Public** to use free GitHub Pages and simple download links. (Private also builds the .exe and .apk; GitHub Pages for a private repository needs a paid GitHub plan.)
2. **Upload these files:** on the new repository page click **uploading an existing file**, then drag in *everything* from this folder, including the **`.github`** folder (on a Mac, press Cmd+Shift+. in Finder to see it). Click **Commit changes**.
3. **Turn on GitHub Pages:** Settings › Pages › Source: **GitHub Actions**. Then Actions › **DocuVault web (GitHub Pages)** › Run workflow. The web address appears there, like `https://YOUR-NAME.github.io/docuvault/`.
4. **Add the Android signing key** (from `DocuVault-Go-signing-key.zip`, kept separately): Settings › Secrets and variables › Actions › New repository secret: `ANDROID_KEYSTORE_BASE64` and `ANDROID_KEYSTORE_PASSWORD`. Then Actions › **DocuVault Go (Android)** › Run workflow.
5. Optional: to use a different server, add a repository *variable* `DOCUVAULT_SERVER` with its address.

Builds start by themselves after every upload that changes the app. Each one takes about 5–10 minutes and posts its file under **Releases** (right side of the repository page).

## Installing

- **Windows:** download `DocuVault-Setup-….exe` and double-click. It installs for that Windows user with no admin rights, adds a desktop shortcut and opens. If Windows says "Windows protected your PC", click **More info › Run anyway** (the installer isn't code-signed; a signing certificate removes this).
- **Android (Go):** on the phone, open the latest Release, download the `.apk`, tap it. Allow "install from this source" once. Updates install over the old version.
- **Phones, Macs, anything else (Vault):** open the GitHub Pages address, then install it from the browser (Chrome: install icon; Android: Add to Home screen; iPhone: Share › Add to Home Screen).

## First-time setup of DocuVault

1. On `https://jainins-server.floot.app`, sign in with your Floot email and click **Connect Google Drive**. Copy the **setup code**.
2. Open DocuVault (desktop or web), enter the setup code, create the super admin and the first business.
3. Add people under **Users & access**. They sign in to Vault or Go with those accounts.

## Folders

- `app/` – DocuVault (Vault) web app, also used inside the Windows program.
- `desktop/` – the Windows program (Electron) and its one-click installer settings.
- `go/` – DocuVault Go screens. `android/` – the Android app around them (scanner and text reader).
- `server/`, `tools/`, `*.bat`, `*.command` – the office-computer server option (see `docs-office-and-cloud-server.md`).
- `.github/workflows/` – the three free GitHub builds.
