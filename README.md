# ArchiveBox Desktop

A simple Electron desktop app for running ArchiveBox on **Windows and Linux**.
It manages a local ArchiveBox Docker container and opens the real ArchiveBox web UI.
For macOS and iOS, use [ArchiveBox.app](https://archivebox.github.io/ios-archivebox/).

[Website and setup guide](https://archivebox.github.io/electron-archivebox/) ·
[Real app screenshots](https://archivebox.github.io/electron-archivebox/screenshots/) ·
[Downloads](https://github.com/ArchiveBox/electron-archivebox/releases) ·
[CI](https://github.com/ArchiveBox/electron-archivebox/actions/workflows/ci.yml)

## Install and use

1. Install and start [Docker Desktop](https://www.docker.com/products/docker-desktop/)
   on Windows (using Linux containers), or Docker Engine / Docker Desktop on Linux.
2. Install the Windows `Setup.exe`, Debian/Ubuntu `.deb`, or Fedora `.rpm` from
   Downloads. CI also retains installers as build artifacts.
3. Open ArchiveBox Desktop, choose your local administrator credentials, and start
   your collection. The first launch downloads the ArchiveBox image.
4. Sign in, add URLs, search your archive, open saved pages, and manage users.
   Activity shows the live crawl monitor. Settings shows the collection location and service controls.

Your archive is stored in `~/archivebox` (your Windows user folder on Windows).
Stopping or quitting the app stops its container and preserves your files. Docker
must remain running while using the app. The app uses the current ArchiveBox `dev`
image for its live activity UI. This is an early desktop fallback;
Docker installation and updates are still managed by Docker itself.

## Develop

Use Node.js 22.14+ and npm 10.9+ with a running Docker daemon:

```sh
npm ci
npm start
```

`ARCHIVEBOX_DATA_DIR`, `ARCHIVEBOX_PORT`, and `DOCKER_HOST` can select a different
collection, local port, or Docker daemon. The default service binds only to
`127.0.0.1`. On Linux your user needs access to the Docker socket.

```sh
npm run lint
npm run make
npm run capture-screenshots
npm run build-site -- --screenshots-dir artifacts/screenshots
```

Capture automation launches the ordinary app, fills forms, and clicks its real
controls. It creates a temporary collection through first-run setup, archives a
real URL, inspects the saved content, manages a user, and stops/restarts the
service. There is no screenshot mode, seeded database, substituted UI, or mocked
backend. Generated PNGs and a revision/coverage manifest stay in ignored artifacts.

CI builds Linux `.deb` / `.rpm` and Windows installers. It drives the packaged Linux
app through the complete Docker-backed journey and the packaged Windows app
through first-run and actual Docker-unavailable guidance (GitHub's Windows runner
does not provide a Linux Docker daemon). The public gallery labels that distinction.
Every successful main-branch run publishes the current site and verified captures.

For headless Linux capture, use `xvfb-run -a npm run capture-screenshots`. Restricted
CI hosts may also require `ELECTRON_DISABLE_SANDBOX=1`; normal desktop launches keep
the Electron renderer sandbox enabled. To capture a packaged build, set
`ELECTRON_EXECUTABLE` to its executable path.
