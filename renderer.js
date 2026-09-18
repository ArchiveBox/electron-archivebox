const ARCHIVEBOX_URL = 'http://127.0.0.1:8085/'

const SCREENS = {
    archive: {
        description: 'Browse everything you have saved and continue building your private archive.',
        heading: 'Your archive',
        label: 'View Archive',
        stats: [
            ['1,284', 'Saved pages'],
            ['96%', 'Indexed'],
            ['12 GB', 'On disk'],
        ],
    },
    'add-urls': {
        description: 'Queue webpages, feeds, and files for ArchiveBox to preserve.',
        heading: 'Save new URLs',
        label: 'Add URLs',
        stats: [
            ['Ready', 'Docker service'],
            ['8', 'Capture methods'],
            ['0', 'Pending jobs'],
        ],
    },
    'manage-users': {
        description: 'Manage access to your ArchiveBox instance and keep your archive private.',
        heading: 'Manage users',
        label: 'Manage Users',
        stats: [
            ['1', 'Administrator'],
            ['2FA', 'Security'],
            ['Private', 'Visibility'],
        ],
    },
    settings: {
        description: 'Configure the local data directory and Docker-backed ArchiveBox service.',
        heading: 'Desktop settings',
        label: 'Settings',
        stats: [
            ['8085', 'Local port'],
            ['Docker', 'Runtime'],
            ['Ready', 'Connection'],
        ],
    },
}

const version = name => window.archivebox?.versions?.[name] || 'unknown'

const renderScreen = requestedScreen => {
    const screenName = Object.prototype.hasOwnProperty.call(SCREENS, requestedScreen)
        ? requestedScreen
        : 'archive'
    const screen = SCREENS[screenName]
    const app = document.getElementById('app')
    if (!app) {
        return
    }

    document.title = `${screen.label} · ArchiveBox`
    app.innerHTML = `
      <div class="app-layout" data-screen="${screenName}">
        <aside class="sidebar">
          <div class="brand">
            <span class="brand-mark">A</span>
            <span>ArchiveBox</span>
          </div>
          <p class="sidebar-caption">Desktop</p>
          <nav class="navigation" aria-label="Primary navigation">
            <a class="nav-link${screenName === 'archive' ? ' active' : ''}" href="?no_redirect=1&screen=archive" data-screen-link="archive">View Archive</a>
            <a class="nav-link${screenName === 'add-urls' ? ' active' : ''}" href="?no_redirect=1&screen=add-urls" data-screen-link="add-urls">Add URLs</a>
            <a class="nav-link${screenName === 'manage-users' ? ' active' : ''}" href="?no_redirect=1&screen=manage-users" data-screen-link="manage-users">Manage Users</a>
            <a class="nav-link${screenName === 'settings' ? ' active' : ''}" href="?no_redirect=1&screen=settings" data-screen-link="settings">Settings</a>
          </nav>
          <div class="sidebar-footer">
            <span class="status-dot"></span>
            <span>Docker connected</span>
          </div>
        </aside>
        <main class="content">
          <header class="topbar">
            <span class="eyebrow">ArchiveBox desktop</span>
            <span class="status-pill"><span class="status-dot"></span> Service online</span>
          </header>
          <section class="hero">
            <p class="section-label">${screen.label}</p>
            <h1>${screen.heading}</h1>
            <p class="hero-description">${screen.description}</p>
            <button class="primary-button" type="button" data-screen-link="${screenName}">${screen.label}</button>
          </section>
          <section class="stats" aria-label="ArchiveBox status">
            ${screen.stats.map(([value, label]) => `<div class="stat-card"><strong>${value}</strong><span>${label}</span></div>`).join('')}
          </section>
          <section class="detail-card">
            <div>
              <p class="section-label">Local service</p>
              <h2>ArchiveBox is ready</h2>
              <p>Everything runs locally through Docker. Your archive stays on this device.</p>
            </div>
            <span class="connection-badge">Connected</span>
          </section>
          <footer class="app-footer">Electron ${version('electron')} · Chrome ${version('chrome')} · Node ${version('node')}</footer>
        </main>
      </div>
    `

    app.querySelectorAll('[data-screen-link]').forEach(link => {
        link.addEventListener('click', event => {
            event.preventDefault()
            renderScreen(link.dataset.screenLink)
        })
    })
}

window.addEventListener('DOMContentLoaded', () => {
    const query = new URLSearchParams(window.location.search)
    const requestedScreen = query.get('screen')
    const archiveLink = document.getElementById('archivebox-link')
    const disableRedirect = query.has('no_redirect')

    if (requestedScreen) {
        renderScreen(requestedScreen)
        return
    }

    if (archiveLink) {
        archiveLink.href = ARCHIVEBOX_URL
    }

    if (disableRedirect) {
        return
    }

    window.setTimeout(() => {
        window.location.replace(ARCHIVEBOX_URL)
    }, 1000)
})
