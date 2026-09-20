const { app, BrowserWindow, ipcMain, Menu, shell, Tray } = require('electron')
const fs = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { createDockerClient } = require('./docker-client')

const DATA_DIR = process.env.ARCHIVEBOX_DATA_DIR || path.join(os.homedir(), 'archivebox')
const configuredPort = Number(process.env.ARCHIVEBOX_PORT || 8085)
const PORT = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort < 65536 ? configuredPort : 8085
const IMAGE = 'archivebox/archivebox:latest'
const ORIGIN = `http://127.0.0.1:${PORT}`
const SETUP_MARKER = `${DATA_DIR}.desktop-setup-pending`
const SHELL_FILES = {
    '/': ['text/html', 'index.html'],
    '/index.html': ['text/html', 'index.html'],
    '/renderer.js': ['text/javascript', 'renderer.js'],
    '/styles.css': ['text/css', 'styles.css'],
}
let mainWindow = null
let tray = null
let docker = null
let container = null
let shellServer = null
let shellOrigin = null
let quitting = false
let busy = false
let setupNeeded = false
let state = { phase: 'starting', message: 'Opening ArchiveBox…', dataDir: DATA_DIR, origin: ORIGIN, image: IMAGE }

const callDocker = (object, method, ...args) => new Promise((resolve, reject) => {
    object[method](...args, (error, result) => error ? reject(error) : resolve(result))
})
const exists = async filename => {
    try { await fs.access(filename); return true } catch (error) {
        if (error.code === 'ENOENT') return false
        throw error
    }
}
const setState = (phase, message) => {
    state = { ...state, phase, message, setupNeeded }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('service-state', state)
    updateTray()
}
const trustedSender = event => event.sender === mainWindow?.webContents && event.senderFrame === event.sender.mainFrame && new URL(event.senderFrame.url).origin === shellOrigin
const openExternal = url => {
    try {
        if (['https:', 'http:'].includes(new URL(url).protocol)) void shell.openExternal(url)
    } catch { /* Ignore invalid or privileged external URLs. */ }
}
const configureWindowSecurity = window => {
    const allowed = url => {
        try { return [shellOrigin, ORIGIN].includes(new URL(url).origin) } catch { return false }
    }
    window.webContents.on('will-navigate', (event, url) => {
        if (new URL(url).origin !== shellOrigin) event.preventDefault()
    })
    window.webContents.on('will-frame-navigate', event => {
        if (!allowed(event.url)) event.preventDefault()
    })
    window.webContents.on('will-redirect', (event, url) => {
        if (!allowed(url)) event.preventDefault()
    })
    window.webContents.setWindowOpenHandler(({ url }) => {
        openExternal(url)
        return { action: 'deny' }
    })
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    window.webContents.session.setPermissionCheckHandler(() => false)
    window.webContents.on('will-attach-webview', event => event.preventDefault())
}
const startShellServer = async () => {
    shellServer = http.createServer(async (request, response) => {
        const asset = Object.hasOwn(SHELL_FILES, new URL(request.url || '/', shellOrigin).pathname)
            ? SHELL_FILES[new URL(request.url || '/', shellOrigin).pathname] : null
        if (!asset || !['GET', 'HEAD'].includes(request.method)) {
            response.writeHead(404); response.end('Not found'); return
        }
        try {
            const content = await fs.readFile(path.join(__dirname, asset[1]))
            response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': `${asset[0]}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff' })
            response.end(request.method === 'HEAD' ? undefined : content)
        } catch {
            response.writeHead(500); response.end('Unable to load the desktop shell')
        }
    })
    await new Promise((resolve, reject) => {
        shellServer.once('error', reject)
        shellServer.listen(0, '127.0.0.1', resolve)
    })
    shellOrigin = `http://127.0.0.1:${shellServer.address().port}`
}
const openWindow = async (route = '/public/') => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
        mainWindow.webContents.send('navigate', route)
        return
    }
    mainWindow = new BrowserWindow({
        width: 1280, height: 860, minWidth: 800, minHeight: 600,
        frame: false, show: false, backgroundColor: '#f7f8fc',
        webPreferences: {
            contextIsolation: true, nodeIntegration: false, sandbox: true,
            preload: path.join(__dirname, 'preload.js'), webSecurity: true,
        },
    })
    configureWindowSecurity(mainWindow)
    mainWindow.once('ready-to-show', () => mainWindow?.show())
    mainWindow.on('closed', () => { mainWindow = null })
    await mainWindow.loadURL(`${shellOrigin}/index.html?route=${encodeURIComponent(route)}`)
}
const createApplicationMenu = () => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        { label: 'File', submenu: [
            { label: 'View Archive', click: () => void openWindow('/public/') },
            { label: 'Add URLs', click: () => void openWindow('/add/') },
            { type: 'separator' },
            { label: 'Settings', click: () => void openWindow('settings') },
            { label: 'Quit ArchiveBox', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
        ] },
        { label: 'Archive', submenu: [
            { label: 'View Archive', click: () => void openWindow('/public/') },
            { label: 'Add URLs', click: () => void openWindow('/add/') },
            { label: 'Manage Users', click: () => void openWindow('/admin/auth/user/') },
        ] },
        { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
        { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'togglefullscreen' }] },
        { label: 'Help', submenu: [
            { label: 'ArchiveBox documentation', click: () => openExternal('https://docs.archivebox.io') },
            { label: 'Get Docker Desktop', click: () => openExternal('https://www.docker.com/products/docker-desktop/') },
        ] },
    ]))
}
const stopContainer = async () => {
    if (!container) return
    const current = container
    try { await callDocker(current, 'stop', { t: 10 }) } catch (error) {
        if (![304, 404].includes(error.statusCode)) throw error
    }
    try { await callDocker(current, 'remove', { force: true }) } catch (error) {
        if (error.statusCode !== 404) throw error
    }
    container = null
}
const pullImage = async () => {
    setState('pulling', 'Downloading ArchiveBox. The first download can take several minutes…')
    const stream = await callDocker(docker, 'pull', IMAGE)
    await new Promise((resolve, reject) => docker.modem.followProgress(stream,
        error => error ? reject(error) : resolve(),
        progress => setState('pulling', `${progress.status || 'Downloading ArchiveBox'}${progress.progress ? ` ${progress.progress}` : ''}`)))
}
const runSetupCommand = async (args, env = []) => {
    const task = await callDocker(docker, 'createContainer', {
        Image: IMAGE, Cmd: ['archivebox', ...args], Env: env,
        HostConfig: { Binds: [`${DATA_DIR}:/data`] },
    })
    try {
        await callDocker(task, 'start')
        const result = await callDocker(task, 'wait')
        if (result.StatusCode !== 0) {
            const logs = await callDocker(task, 'logs', { stdout: true, stderr: true, tail: 30 })
            throw new Error(`ArchiveBox setup failed (${result.StatusCode}): ${logs.toString('utf8')}`)
        }
    } finally {
        await callDocker(task, 'remove', { force: true })
    }
}
const waitForService = async () => {
    const deadline = Date.now() + 120000
    while (Date.now() < deadline && !quitting) {
        const details = await callDocker(container, 'inspect')
        if (!details.State.Running) {
            const logs = await callDocker(container, 'logs', { stdout: true, stderr: true, tail: 20 })
            throw new Error(`ArchiveBox exited: ${logs.toString('utf8')}`)
        }
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 3000)
        try {
            const response = await fetch(`${ORIGIN}/public/`, { redirect: 'manual', signal: controller.signal })
            if ([200, 301, 302].includes(response.status)) return
        } catch { /* The container may still be initializing the server. */ }
        finally { clearTimeout(timeout) }
        await new Promise(resolve => setTimeout(resolve, 1000))
    }
    throw new Error('ArchiveBox did not become ready within two minutes. Check Docker and restart the service.')
}
const startDocker = async (credentials, update = false) => {
    if (busy || quitting) return state
    if (setupNeeded && !credentials) {
        setState('setup', 'Create your local ArchiveBox administrator account.'); return state
    }
    busy = true
    try {
        setState('connecting', 'Connecting to Docker. Make sure Docker Desktop is installed and running.')
        docker = docker || createDockerClient({ timeout: 100000 })
        await callDocker(docker, 'ping')
        await fs.mkdir(DATA_DIR, { recursive: true })
        if (update) await pullImage()
        else {
            try { await callDocker(docker.getImage(IMAGE), 'inspect') } catch (error) {
                if (error.statusCode !== 404) throw error
                await pullImage()
            }
        }
        if (quitting) return state
        if (setupNeeded) {
            setState('starting', 'Initializing your archive and administrator account…')
            await fs.writeFile(SETUP_MARKER, '')
            await runSetupCommand(['init', '--quick'])
            await runSetupCommand(['manage', 'createsuperuser', '--noinput', '--username', credentials.username, '--email', credentials.email || ''], [`DJANGO_SUPERUSER_PASSWORD=${credentials.password}`])
            await fs.rm(SETUP_MARKER)
            setupNeeded = false
        }
        if (quitting) return state
        await stopContainer()
        setState('starting', 'Starting the local ArchiveBox server…')
        container = await callDocker(docker, 'createContainer', {
            Image: IMAGE, Cmd: ['archivebox', 'server', '--init', `0.0.0.0:${PORT}`],
            HostConfig: {
                Binds: [`${DATA_DIR}:/data`],
                PortBindings: { [`${PORT}/tcp`]: [{ HostIp: '127.0.0.1', HostPort: String(PORT) }] },
            },
            ExposedPorts: { [`${PORT}/tcp`]: {} },
            name: process.env.ARCHIVEBOX_CONTAINER_NAME || `archivebox-desktop-${process.pid}`,
        })
        await callDocker(container, 'start')
        await waitForService()
        setState('running', 'Connected • Local ArchiveBox')
        monitorContainer(container)
    } catch (error) {
        console.error(`[X] Failed to start ArchiveBox: ${error.message}`)
        setState('error', `${error.message}\nMake sure Docker is running, then try again. Your archive is saved in ${DATA_DIR}.`)
    } finally { busy = false }
    return state
}
const monitorContainer = current => {
    setTimeout(async () => {
        if (quitting || container !== current || state.phase !== 'running') return
        try {
            const details = await callDocker(current, 'inspect')
            if (!details.State.Running) throw new Error('The ArchiveBox container stopped unexpectedly. Restart it to continue.')
            monitorContainer(current)
        } catch (error) { setState('error', error.message) }
    }, 5000)
}
const updateTray = () => {
    if (!tray) return
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: `ArchiveBox: ${state.phase}`, enabled: false },
        { label: 'Open ArchiveBox', click: () => void openWindow() },
        { label: 'Add URLs', click: () => void openWindow('/add/') },
        { label: 'Settings', click: () => void openWindow('settings') },
        { type: 'separator' },
        { label: 'Quit ArchiveBox', click: () => app.quit() },
    ]))
}

ipcMain.handle('service-state', event => {
    if (!trustedSender(event)) throw new Error('Untrusted window')
    return state
})
ipcMain.handle('service-action', async (event, action, credentials) => {
    if (!trustedSender(event)) throw new Error('Untrusted window')
    if (busy) return state
    if (action === 'start' || action === 'restart' || action === 'update') {
        if (setupNeeded && credentials) {
            if (typeof credentials.username !== 'string' || !/^[\w.@+-]{1,150}$/.test(credentials.username) || typeof credentials.password !== 'string' || credentials.password.length < 8 || (credentials.email && typeof credentials.email !== 'string')) {
                throw new Error('Enter a valid username and a password of at least eight characters.')
            }
        }
        return startDocker(credentials, action === 'update')
    }
    if (action === 'stop') {
        busy = true
        setState('stopping', 'Stopping ArchiveBox…')
        try { await stopContainer(); setState('stopped', 'ArchiveBox is stopped. Your saved archive is safe.') }
        catch (error) { setState('error', error.message) }
        finally { busy = false }
    } else if (action === 'open-data') {
        await fs.mkdir(DATA_DIR, { recursive: true })
        const error = await shell.openPath(DATA_DIR)
        if (error) throw new Error(error)
    } else if (action === 'docker-help') openExternal('https://www.docker.com/products/docker-desktop/')
    return state
})
ipcMain.on('menu-open', (event, label) => {
    if (trustedSender(event)) Menu.getApplicationMenu()?.items.find(item => item.label === label)?.submenu?.popup({ window: mainWindow })
})
for (const action of ['close', 'maximize', 'minimize']) {
    ipcMain.on(`window-${action}`, event => {
        if (!trustedSender(event)) return
        if (action === 'maximize' && mainWindow.isMaximized()) mainWindow.unmaximize()
        else mainWindow[action]()
    })
}

const bootstrap = async () => {
    if (require('electron-squirrel-startup') || !app.requestSingleInstanceLock()) { app.quit(); return }
    if (process.platform === 'win32') app.setAppUserModelId('com.archivebox.desktop')
    app.on('second-instance', () => void openWindow())
    app.on('activate', () => void openWindow())
    app.on('window-all-closed', () => { if (!tray) app.quit() })
    app.on('before-quit', event => {
        if (quitting) return
        event.preventDefault()
        quitting = true
        void (async () => {
            while (busy) await new Promise(resolve => setTimeout(resolve, 100))
            await stopContainer()
            if (shellServer) await new Promise(resolve => shellServer.close(resolve))
        })().catch(error => console.error(error)).finally(() => app.quit())
    })
    await app.whenReady()
    await startShellServer()
    createApplicationMenu()
    try {
        tray = new Tray(path.join(__dirname, 'icon.png'))
        tray.setToolTip('ArchiveBox')
        tray.on('click', () => void openWindow())
        updateTray()
    } catch (error) { console.warn(`Tray unavailable: ${error.message}`) }
    setupNeeded = !await exists(path.join(DATA_DIR, 'index.sqlite3')) || await exists(SETUP_MARKER)
    await openWindow()
    void startDocker()
}
void bootstrap().catch(error => {
    console.error(`[X] ArchiveBox failed to start: ${error.stack || error.message}`)
    app.quit()
})
