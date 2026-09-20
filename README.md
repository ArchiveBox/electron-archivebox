# ArchiveBox Desktop

A simple Electron desktop app for running ArchiveBox on **Windows, Linux, and Mac**.
It manages a local ArchiveBox Docker container and opens the real ArchiveBox web UI.
For the recommended native macOS and iOS experience, use [ArchiveBox.app](https://app.archivebox.io/).

[Website and setup guide](https://electron.archivebox.io/) ·
[Real app screenshots](https://electron.archivebox.io/screenshots/) ·
[Downloads](https://github.com/ArchiveBox/electron-archivebox/releases) ·
[CI](https://github.com/ArchiveBox/electron-archivebox/actions/workflows/ci.yml)

## Install and use

1. Install and start [Docker Desktop](https://www.docker.com/products/docker-desktop/)
   on Windows (using Linux containers), or Docker Engine / Docker Desktop on Linux.
2. Download the [Windows installer](https://github.com/ArchiveBox/electron-archivebox/releases/latest/download/ArchiveBox-Windows.exe),
   [Debian/Ubuntu package](https://github.com/ArchiveBox/electron-archivebox/releases/latest/download/ArchiveBox-Linux.deb),
   [Fedora package](https://github.com/ArchiveBox/electron-archivebox/releases/latest/download/ArchiveBox-Linux.rpm), or
   [universal Mac DMG](https://github.com/ArchiveBox/electron-archivebox/releases/latest/download/ArchiveBox-Mac.dmg).
   Installers are unsigned; your OS may ask you to approve them on first launch.
3. Open ArchiveBox Desktop, choose your local administrator credentials, and start
   your collection. The first launch downloads the ArchiveBox image.
4. Sign in, add URLs, search your archive, open saved pages, and manage users.
   Activity shows the live crawl monitor. Settings shows the collection location and service controls.

Your archive is stored in `~/archivebox` (your Windows user folder on Windows).
In Settings, choose localhost-only access, all network interfaces for LAN access,
or a specific interface address. You can also edit the port and public base URL.
Apply & restart checks the new configuration before saving it; your collection
stays in place. Leave the base URL blank to use the address you connect through.
Stopping or quitting the app stops its container and preserves your files. Docker
must remain running while using the app. The app uses the current ArchiveBox `dev`
image for its live activity UI.
Docker installation and updates are still managed by Docker itself.

## Develop

Use Node.js 22.14+ and npm 10.9+ with a running Docker daemon:

```sh
npm ci
npm start
```

`ARCHIVEBOX_DATA_DIR`, `ARCHIVEBOX_PORT`, and `DOCKER_HOST` can select a different
collection, local port, or Docker daemon. The default service binds only to
`127.0.0.1:5797`, the same default port as ArchiveBox Server. On Linux your user needs access to the Docker socket.

```sh
npm run lint
npm run make
npm run capture-screenshots
```

Capture automation launches the ordinary app, fills forms, and clicks its real
controls. It creates a temporary collection through first-run setup, archives a
real URL, inspects the saved content, manages a user, and stops/restarts the
service. There is no screenshot mode, seeded database, substituted UI, or mocked
backend. Generated PNGs and a revision/coverage manifest stay in ignored artifacts.

Every main-branch change builds a new version (`0.7.<workflow run number>`), installs
and exercises the installers, then publishes a GitHub release with Windows `.exe`,
Linux `.deb` / `.rpm`, universal Mac `.dmg`, and SHA256 checksums. The download URLs
above always resolve to the latest release. Version stamping is recorded separately
from the source revision in screenshot manifests.

CI drives the installed Linux app through the complete Docker-backed journey and
the installed Windows and Mac apps through first-run and actual Docker-unavailable
guidance (those GitHub runners do not provide a Linux Docker daemon). The public
gallery labels that distinction. Every successful main run publishes the current
site and verified captures. Download the three `archivebox-screenshots-*` artifacts
into `artifacts/screenshots/{linux,windows,macos}` to rebuild that gallery with
`npm run build-site`.

For headless Linux capture, use `xvfb-run -a npm run capture-screenshots`.
To capture a packaged build, set
`ELECTRON_EXECUTABLE` to its executable path.
