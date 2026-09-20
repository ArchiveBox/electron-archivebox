let state = null
let route = new URLSearchParams(window.location.search).get('route') || '/public/'
let settingsOpen = route === 'settings'
let networkSaving = false
let renderedNetwork = ''
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
    document.querySelectorAll('[data-route]').forEach(button => {
        button.disabled = !running
        button.classList.toggle('is-active', running && !settingsOpen && button.dataset.route === route)
    })
    element('settings-button').classList.toggle('is-active', settingsOpen)
    element('settings-button').setAttribute('aria-pressed', String(settingsOpen))
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
    const networkKey = JSON.stringify(state.network)
    if (state.network && networkKey !== renderedNetwork) {
        element('network-scope').value = state.network.scope
        element('network-bind-address').value = state.network.bindAddress
        element('network-port').value = state.network.port
        element('network-base-url').value = state.network.baseURL
        element('network-bind-label').hidden = state.network.scope !== 'custom'
        renderedNetwork = networkKey
    }
    element('network-save').textContent = state.setupNeeded ? 'Save network settings' : 'Apply & restart'
    element('network-form').querySelectorAll('input, select, button').forEach(control => { control.disabled = busy || networkSaving })
    if (running && !wasRunning) {
        if (settingsOpen) window.archivebox.navigate(normalizeRoute(route))
        else setArchiveRoute(route)
    }
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
    element('setup-network-settings').addEventListener('click', () => { settingsOpen = true; renderState(state) })
    element('network-scope').addEventListener('change', () => { element('network-bind-label').hidden = element('network-scope').value !== 'custom' })
    element('network-form').addEventListener('submit', async event => {
        event.preventDefault()
        const settings = { scope: element('network-scope').value, bindAddress: element('network-bind-address').value, port: Number(element('network-port').value), baseURL: element('network-base-url').value }
        networkSaving = true
        element('network-status').textContent = state.setupNeeded ? 'Saving network settings…' : 'Applying network settings and restarting…'
        renderState(state)
        try {
            const next = await window.archivebox.action('save-network', settings)
            renderState(next)
            element('network-status').textContent = `Network settings saved. Listen address: ${next.network.bindAddress}:${next.network.port}.`
        } catch (error) { element('network-status').textContent = error.message }
        finally { networkSaving = false; renderState(state) }
    })
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
