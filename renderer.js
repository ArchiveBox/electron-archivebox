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

const NAVIGATION = [
    ['archive', 'View Archive'],
    ['add-urls', 'Add URLs'],
    ['manage-users', 'Manage Users'],
    ['settings', 'Settings'],
]

const version = name => window.archivebox?.versions?.[name] || 'unknown'

const createElement = (tagName, className, text) => {
    const element = document.createElement(tagName)
    if (className) {
        element.className = className
    }
    if (text) {
        element.textContent = text
    }
    return element
}

const createNavigationLink = (screenName, label, active) => {
    const link = createElement('a', `nav-link${active ? ' active' : ''}`, label)
    link.href = `?no_redirect=1&screen=${screenName}`
    link.dataset.screenLink = screenName
    return link
}

const addScreenNavigation = app => {
    app.querySelectorAll('[data-screen-link]').forEach(link => {
        link.addEventListener('click', event => {
            event.preventDefault()
            renderScreen(link.dataset.screenLink)
        })
    })
}

const renderScreen = requestedScreen => {
    const screen = Object.prototype.hasOwnProperty.call(SCREENS, requestedScreen)
        ? SCREENS[requestedScreen]
        : SCREENS.archive
    const app = document.getElementById('app')
    if (!app) {
        return
    }

    document.title = `${screen.label} · ArchiveBox`
    const layout = createElement('div', 'app-layout')
    const sidebar = createElement('aside', 'sidebar')
    const brand = createElement('div', 'brand')
    brand.append(
        createElement('span', 'brand-mark', 'A'),
        createElement('span', null, 'ArchiveBox')
    )
    sidebar.append(brand, createElement('p', 'sidebar-caption', 'Desktop'))

    const navigation = createElement('nav', 'navigation')
    navigation.setAttribute('aria-label', 'Primary navigation')
    NAVIGATION.forEach(([screenName, label]) => {
        navigation.append(createNavigationLink(screenName, label, screenName === requestedScreen))
    })
    sidebar.append(navigation)

    const sidebarFooter = createElement('div', 'sidebar-footer')
    sidebarFooter.append(createElement('span', 'status-dot'), createElement('span', null, 'Docker connected'))
    sidebar.append(sidebarFooter)

    const content = createElement('main', 'content')
    const topbar = createElement('header', 'topbar')
    topbar.append(
        createElement('span', 'eyebrow', 'ArchiveBox desktop'),
        createElement('span', 'status-pill', '●  Service online')
    )
    content.append(topbar)

    const hero = createElement('section', 'hero')
    hero.append(
        createElement('p', 'section-label', screen.label),
        createElement('h1', null, screen.heading),
        createElement('p', 'hero-description', screen.description)
    )
    const primaryButton = createElement('button', 'primary-button', screen.label)
    primaryButton.type = 'button'
    primaryButton.dataset.screenLink = requestedScreen
    hero.append(primaryButton)
    content.append(hero)

    const stats = createElement('section', 'stats')
    stats.setAttribute('aria-label', 'ArchiveBox status')
    screen.stats.forEach(([value, label]) => {
        const statCard = createElement('div', 'stat-card')
        statCard.append(createElement('strong', null, value), createElement('span', null, label))
        stats.append(statCard)
    })
    content.append(stats)

    const detailCard = createElement('section', 'detail-card')
    const detail = createElement('div')
    detail.append(
        createElement('p', 'section-label', 'Local service'),
        createElement('h2', null, 'ArchiveBox is ready'),
        createElement('p', null, 'Everything runs locally through Docker. Your archive stays on this device.')
    )
    detailCard.append(detail, createElement('span', 'connection-badge', 'Connected'))
    content.append(detailCard)

    content.append(createElement(
        'footer',
        'app-footer',
        `Electron ${version('electron')} · Chrome ${version('chrome')} · Node ${version('node')}`
    ))
    layout.append(sidebar, content)
    app.replaceChildren(layout)
    app.className = ''
    addScreenNavigation(app)
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
