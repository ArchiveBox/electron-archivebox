<div align="center">

# ArchiveBox Desktop (alpha, help wanted!)

*Electron desktop app concept for ArchiveBox.*

<img src="https://i.imgur.com/QPHUS5C.png" width="400px">
<br/>

*We're looking for contributors to help make our dekstop app experience better!*

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

# Run the app
npm start
```

Note: If you're using Linux Bash for Windows, [see this guide](https://www.howtogeek.com/261575/how-to-run-graphical-linux-desktop-applications-from-windows-10s-bash-shell/) or use `node` from the command prompt.
