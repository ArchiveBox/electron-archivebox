const archiveboxOrigin = window.archivebox?.origin || 'http://127.0.0.1:8085'
const archiveboxWindow = window.archivebox?.window

const normalizeRoute = route => {
    if (!route || !route.startsWith('/') || route.startsWith('//')) {
        return '/public/'
    }
    return route
}

const setArchiveRoute = route => {
    const frame = document.getElementById('archivebox-frame')
    const loading = document.getElementById('frame-loading')
    const normalizedRoute = normalizeRoute(route)

    loading?.classList.remove('is-hidden')
    if (frame) {
        frame.src = `${archiveboxOrigin}${normalizedRoute}`
    }

    document.querySelectorAll('[data-route]').forEach(button => {
        button.classList.toggle('is-active', button.dataset.route === normalizedRoute)
    })
}

window.addEventListener('DOMContentLoaded', () => {
    const frame = document.getElementById('archivebox-frame')
    const loading = document.getElementById('frame-loading')
    const status = document.getElementById('service-status')
    const route = new URLSearchParams(window.location.search).get('route')

    document.getElementById('minimize-window')?.addEventListener('click', () => archiveboxWindow?.minimize())
    document.getElementById('maximize-window')?.addEventListener('click', () => archiveboxWindow?.maximize())
    document.getElementById('close-window')?.addEventListener('click', () => archiveboxWindow?.close())

    document.querySelectorAll('[data-route]').forEach(button => {
        button.addEventListener('click', () => setArchiveRoute(button.dataset.route))
    })

    frame?.addEventListener('load', () => {
        loading?.classList.add('is-hidden')
        if (status) {
            status.textContent = 'Connected • Local ArchiveBox'
        }
    })

    setArchiveRoute(route || '/public/')
})
