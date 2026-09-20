let state = null
let route = new URLSearchParams(window.location.search).get('route') || '/public/'
let settingsOpen = route === 'settings'
const element = id => document.getElementById(id)
const busyPhases = ['connecting', 'pulling', 'starting', 'stopping']
const normalizeRoute = value => value?.startsWith('/') && !value.startsWith('//') ? value : '/public/'
const setArchiveRoute = value => {
    if (value === 'settings') { settingsOpen = true; renderState(state); return }
    settingsOpen = false
    route = normalizeRoute(value)
    if (state?.phase === 'running') {
        window.archivebox.navigate(route)
    }
    document.querySelectorAll('[data-route]').forEach(button => button.classList.toggle('is-active', button.dataset.route === route))
    renderState(state)
}
const renderState = next => {
    if (!next) return
    const wasRunning = state?.phase === 'running'
    state = next
    const running = state.phase === 'running'
    const busy = busyPhases.includes(state.phase)
    element('service-status').textContent = running ? state.message : `ArchiveBox • ${state.phase}`
    element('service-panel').dataset.state = state.phase
    element('service-panel').hidden = running || settingsOpen
    element('settings-panel').hidden = !settingsOpen
    window.archivebox.setArchiveVisible(running && !settingsOpen)
    element('service-message').textContent = state.message
    element('service-heading').textContent = ({ setup: 'Welcome to ArchiveBox', error: 'ArchiveBox needs your attention', stopped: 'ArchiveBox is stopped', connecting: 'Connecting to Docker', pulling: 'Downloading ArchiveBox', starting: 'Starting ArchiveBox', stopping: 'Stopping ArchiveBox' })[state.phase] || 'ArchiveBox'
    element('setup-form').hidden = !state.setupNeeded || busy
    element('start-service').hidden = !['error', 'stopped'].includes(state.phase) || state.setupNeeded
    element('start-service').textContent = state.phase === 'error' ? 'Try again' : 'Start ArchiveBox'
    document.querySelectorAll('[data-route]').forEach(button => { button.disabled = !running })
    document.querySelectorAll('[data-action]').forEach(button => {
        button.disabled = busy && !['docker-help', 'open-data'].includes(button.dataset.action)
    })
    element('stop-service').disabled = busy || !running
    element('restart-service').disabled = busy || state.setupNeeded
    element('update-service').disabled = busy || state.setupNeeded
    element('settings-status').textContent = state.message
    element('settings-data').textContent = state.dataDir
    element('settings-origin').textContent = state.origin
    element('settings-image').textContent = state.image
    if (running && !wasRunning) setArchiveRoute(route)
}
const action = async (name, credentials) => {
    element('settings-error').textContent = ''
    try {
        renderState(await window.archivebox.action(name, credentials))
        if (name === 'copy-address') element('copy-address').textContent = 'Address copied'
    }
    catch (error) {
        element('settings-error').textContent = error.message
        element('service-message').textContent = error.message
    }
}
window.addEventListener('DOMContentLoaded', async () => {
    for (const name of ['minimize', 'maximize', 'close']) {
        element(`${name}-window`).addEventListener('click', () => window.archivebox.window[name]())
    }
    document.querySelectorAll('.menu-item').forEach(button => button.addEventListener('click', () => window.archivebox.openMenu(button.textContent)))
    document.querySelectorAll('[data-route]').forEach(button => button.addEventListener('click', () => setArchiveRoute(button.dataset.route)))
    document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => void action(button.dataset.action)))
    element('settings-button').addEventListener('click', () => { settingsOpen = !settingsOpen; renderState(state) })
    element('close-settings').addEventListener('click', () => { settingsOpen = false; renderState(state) })
    element('setup-form').addEventListener('submit', event => {
        event.preventDefault()
        void action('start', { username: element('setup-username').value, email: element('setup-email').value, password: element('setup-password').value })
        element('setup-password').value = ''
    })
    const content = document.querySelector('.archive-content')
    new window.ResizeObserver(() => window.archivebox.setArchiveTop(content.getBoundingClientRect().top)).observe(content)
    window.archivebox.onState(renderState)
    window.archivebox.onNavigate(setArchiveRoute)
    renderState(await window.archivebox.getState())
})
