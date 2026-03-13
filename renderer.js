const ARCHIVEBOX_URL = 'http://127.0.0.1:8085/'

window.addEventListener('DOMContentLoaded', () => {
  const archiveLink = document.getElementById('archivebox-link')
  const disableRedirect = new URLSearchParams(window.location.search).has('noRedirect')

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
