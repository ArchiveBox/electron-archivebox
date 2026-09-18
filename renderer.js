const archiveboxOrigin = window.archivebox?.origin || 'http://127.0.0.1:8085'

window.addEventListener('DOMContentLoaded', () => {
    const archiveLink = document.getElementById('archivebox-link')
    const disableRedirect = new URLSearchParams(window.location.search).has('no_redirect')

    if (archiveLink) {
        archiveLink.href = `${archiveboxOrigin}/`
    }

    if (!disableRedirect) {
        window.setTimeout(() => {
            window.location.replace(`${archiveboxOrigin}/`)
        }, 1000)
    }
})
