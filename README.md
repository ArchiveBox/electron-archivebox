<div align="center">

# ArchiveBox Desktop (alpha, help wanted!)

*Electron desktop app concept for ArchiveBox.*

![CI](https://github.com/ArchiveBox/electron-archivebox/actions/workflows/ci.yml/badge.svg)

<img src="https://i.imgur.com/QPHUS5C.png" width="400px">
<br/>

*We're looking for contributors to help make our desktop app experience better!*

Reach out [on Twitter](https://twitter.com/ArchiveBoxApp) or open [an issue](https://github.com/ArchiveBox/electron-archivebox/issues) if you're interested in helping.

</div>

---

## Quickstart

The desktop app depends on Docker already being installed and running on your system.
This is a hard dependency as the Desktop app is just a wrapper around the Docker container (for now).
(Cross-platform packaging of Python + JS + Chrome + wget + curl and more without Docker is a hard problem)

Yes, it's an Electron app, yes, I'm sorry. Electron is just so easy compared to the alternatives, and I don't have the time to do full native development.

https://docs.docker.com/get-docker/

```bash
# Clone this repository
git clone https://github.com/ArchiveBox/electron-archivebox && cd electron-archivebox

# Install dependencies
npm install

# Verify Docker-backed app behavior in a sandbox
npm run smoke-test

# Run the app
npm start
```

For headless Linux sandboxes, this app has also been verified with:

```bash
ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a npm start
```

Note: If you're using Linux Bash for Windows, [see this guide](https://www.howtogeek.com/261575/how-to-run-graphical-linux-desktop-applications-from-windows-10s-bash-shell/) or use `node` from the command prompt.

## Development checks

The project uses Electron 44, Electron Forge, and Node.js 22 or newer. Run the
same checks used by CI before opening a pull request:

```bash
npm ci
npm run lint
npm run package
```

The Windows CI job also builds the Squirrel installer and captures the
View Archive, Add URLs, Manage Users, and Settings screens without requiring a
Docker daemon. The generated screenshots are published in the
[desktop screen gallery](https://archivebox.github.io/electron-archivebox/).
