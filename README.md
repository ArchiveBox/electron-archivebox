<div align="center">
<img src="assets/icon.png" width="88" height="88" alt="ArchiveBox Desktop icon">
<h1>ArchiveBox Desktop</h1>
<p><strong>Your web archive. On your desktop.</strong><br>Save websites, browse your collection, and run ArchiveBox on Windows, Linux, and Mac.</p>

<p>
<a href="https://github.com/ArchiveBox/electron-archivebox/releases/latest/download/ArchiveBox-Windows.exe"><img src="https://img.shields.io/badge/Download-Windows-0078D4?style=for-the-badge" alt="Download for Windows"></a>
<a href="#downloads"><img src="https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&amp;logo=linux&amp;logoColor=black" alt="Download for Linux"></a>
<a href="https://github.com/ArchiveBox/electron-archivebox/releases/latest/download/ArchiveBox-Mac.dmg"><img src="https://img.shields.io/badge/Download-macOS-333333?style=for-the-badge&amp;logo=apple&amp;logoColor=white" alt="Download for macOS"></a>
</p>
<p>
<a href="LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-blue" alt="GPL-3.0 license"></a>
<a href="https://github.com/ArchiveBox/electron-archivebox/stargazers"><img src="https://img.shields.io/github/stars/ArchiveBox/electron-archivebox?style=flat&amp;label=Star%20on%20GitHub" alt="GitHub stars"></a>
</p>
<p><a href="https://electron.archivebox.io/">Website</a> &nbsp; · &nbsp; <a href="#get-started">Get started</a> &nbsp; · &nbsp; <a href="https://electron.archivebox.io/screenshots/">Screenshots</a> &nbsp; · &nbsp; <a href="https://github.com/ArchiveBox/electron-archivebox/issues">Help &amp; feedback</a></p>
</div>

<p align="center">
<a href="https://electron.archivebox.io/screenshots/macos/archive.png"><img src="https://electron.archivebox.io/screenshots/macos/archive.png" width="49%" alt="ArchiveBox Desktop on Mac: saved pages with titles, URLs, and tags"></a>
<a href="https://electron.archivebox.io/screenshots/macos/activity.png"><img src="https://electron.archivebox.io/screenshots/macos/activity.png" width="49%" alt="ArchiveBox Desktop on Mac: live archiving activity and download progress"></a>
<br><sub>Your saved pages &nbsp; · &nbsp; Live archiving progress — shown on macOS. Click either screenshot to enlarge.</sub>
</p>

**[ArchiveBox](https://archivebox.io/) saves copies of websites so you can revisit them after they change or disappear.** ArchiveBox Desktop brings your collection, archiving activity, and server controls together in one app, with the files stored on your own computer.

- 📥 **Save the pages you care about.** Add links individually or paste a list, choose what to capture, and let ArchiveBox do the archiving.
- 🔎 **Find it again.** Search saved pages, organize them with tags, and browse your collection as a list or grid.
- 🗂️ **Keep more than a bookmark.** Open saved snapshots and explore their captured pages, screenshots, and other output files.
- 📊 **Follow archiving progress.** See current downloads and jobs in Activity.
- 🖥️ **Keep your server close.** Start, stop, restart, and update ArchiveBox from Settings. Close the window and keep it running in the tray.
- 🌐 **Use your archive across devices.** Keep access on this computer or enable access over your local network.

On a Mac, iPhone, or iPad? [ArchiveBox.app](https://app.archivebox.io/) is our recommended native Apple experience. This desktop app is also available for Mac.

## Downloads

| Platform | Download |
| --- | --- |
| 🪟 Windows | [Windows installer (.exe)](https://github.com/ArchiveBox/electron-archivebox/releases/latest/download/ArchiveBox-Windows.exe) |
| 🐧 Debian / Ubuntu | [Linux package (.deb)](https://github.com/ArchiveBox/electron-archivebox/releases/latest/download/ArchiveBox-Linux.deb) |
| 🐧 Fedora / RHEL | [Linux package (.rpm)](https://github.com/ArchiveBox/electron-archivebox/releases/latest/download/ArchiveBox-Linux.rpm) |
| 🍎 macOS | [Mac disk image (.dmg) — Intel & Apple Silicon](https://github.com/ArchiveBox/electron-archivebox/releases/latest/download/ArchiveBox-Mac.dmg) |

[All releases & release notes](https://github.com/ArchiveBox/electron-archivebox/releases). Installers are unsigned, so your operating system may ask you to approve the app on first launch.

## Get started

1. **Install and start Docker.** Use [Docker Desktop](https://www.docker.com/products/docker-desktop/) on Windows or Mac, or Docker Desktop / Docker Engine on Linux. On Windows, use Linux containers.
2. **Install ArchiveBox Desktop.** Download the installer for your platform above, install it, and open the app.
3. **Create your administrator account.** Choose your username and password when prompted. The first launch downloads ArchiveBox and prepares your collection, which can take a few minutes.
4. **Save your first link.** Sign in, choose **Add URLs**, paste a website address, and start archiving. Open **Activity** to follow its progress, then browse the saved page.

Keep Docker running while you use ArchiveBox. You need an internet connection to download ArchiveBox initially and to save new websites.

## Save, search, and revisit

Use **Add URLs** to save one page or a whole list. Add tags such as `research`, `recipes`, or `read-later`, and choose the output formats you want to keep.

Browse your collection to find a saved page, switch between list and grid views, or search for a title, URL, or text. Open a snapshot to revisit the archived page and inspect its saved files. Use **Activity** to see what is still being archived, and **Manage Users** to manage accounts.

Want to save pages directly from your browser? Connect the [ArchiveBox browser extension](https://extension.archivebox.io/) to your running server.

## Your archive, on your computer

Your collection lives in the `archivebox` folder inside your home folder (`~/archivebox`). **Settings → Open Archive Folder** opens it in your file manager. Back up this folder to keep another copy of your archive.

- **Close the window** to keep ArchiveBox running in the tray.
- **Stop ArchiveBox** in Settings to stop the server without deleting your collection.
- **Quit ArchiveBox** to close the app and stop its server. Your saved files stay in place.
- **Update ArchiveBox** in Settings to download the latest server version and restart it. Desktop app downloads are available from [Releases](https://github.com/ArchiveBox/electron-archivebox/releases).

## Connect from another device

By default, your server is available only on this computer, on port **5797**. To use it from another device on your local network:

1. Open **Settings** and change **Listen on** to **All interfaces / LAN**.
2. Choose **Apply & restart**.
3. On the other device, open `http://YOUR-COMPUTER-IP:5797` in a browser and sign in. Use your computer’s local network address in place of `YOUR-COMPUTER-IP`.

Keep the computer awake and Docker and ArchiveBox running. Settings also lets you change the port, select a specific interface, or set a **Base URL** if you use a fixed server address. Leave Base URL blank for automatic addressing.

## Help & feedback

- 📖 [ArchiveBox documentation](https://github.com/ArchiveBox/ArchiveBox/wiki) — archiving, output formats, and managing your collection.
- 💬 [Community forum](https://zulip.archivebox.io/) — ask questions and share how you use ArchiveBox.
- 🐛 [Report a desktop app issue](https://github.com/ArchiveBox/electron-archivebox/issues) — include your operating system, app version, and what happened.
- 🖼️ [Explore the screenshot gallery](https://electron.archivebox.io/screenshots/) — setup, saved pages, search, settings, and more.

Free and open source under the [GNU GPL v3 license](LICENSE).

<p align="center"><a href="https://archivebox.io/">ArchiveBox Server</a> &nbsp; · &nbsp; <a href="https://app.archivebox.io/">Apple apps</a> &nbsp; · &nbsp; <a href="https://extension.archivebox.io/">Browser extension</a> &nbsp; · &nbsp; <a href="https://github.com/sponsors/pirate">Support the project ♡</a></p>
