const { app, BrowserWindow, ipcMain, Menu, shell, Tray } = require('electron')
const fs = require('node:fs/promises')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { URL } = require('node:url')
const { createDockerClient } = require('./docker-client')

const DATA_DIR = process.env.ARCHIVEBOX_DATA_DIR || path.join(os.homedir(), 'archivebox')
const BIND_HOST = '0.0.0.0'
const configuredPort = Number.parseInt(process.env.ARCHIVEBOX_PORT || '8085', 10)
const BIND_PORT = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 8085
const DOCKER_IMAGE = 'archivebox/archivebox:latest'
const DOCKER_CMD = ['archivebox', 'server', '--init', `${BIND_HOST}:${BIND_PORT}`]
const ARCHIVEBOX_ORIGIN = `http://127.0.0.1:${BIND_PORT}`
const SHELL_FILES = Object.freeze({
    '/': { contentType: 'text/html; charset=utf-8', file: 'index.html' },
    '/index.html': { contentType: 'text/html; charset=utf-8', file: 'index.html' },
    '/renderer.js': { contentType: 'text/javascript; charset=utf-8', file: 'renderer.js' },
    '/styles.css': { contentType: 'text/css; charset=utf-8', file: 'styles.css' },
})

let mainWindow = null
let tray = null
let docker = null
let container = null
let shellServer = null
let shellOrigin = null
let quitting = false

const callDocker = (dockerObject, method, ...args) => new Promise((resolve, reject) => {
    dockerObject[method](...args, (error, result) => {
        if (error) {
            reject(error)
            return
        }
        resolve(result)
    })
})

const followProgress = stream => new Promise((resolve, reject) => {
    docker.modem.followProgress(stream, (error, output) => {
        if (error) {
            reject(error)
            return
        }
        resolve(output)
    })
})

const isAllowedNavigation = url => {
    try {
        const parsedUrl = new URL(url)
        return parsedUrl.origin === ARCHIVEBOX_ORIGIN || parsedUrl.origin === shellOrigin
    } catch {
        return false
    }
}

const routeForUrl = url => {
    try {
        const pathname = new URL(url).pathname
        if (pathname === '/add/' || pathname.startsWith('/accounts/')) {
            return '/add/'
        }
        if (pathname.startsWith('/admin/')) {
            return '/admin/auth/user/'
        }
        if (pathname.startsWith('/archive/')) {
            return pathname
        }
    } catch {
        // Fall back to the archive route when a tray action has no URL.
    }
    return '/public/'
}

const configureWindowSecurity = window => {
    const handleNavigation = (event, url) => {
        if (!isAllowedNavigation(url)) {
            event.preventDefault()
        }
    }

    window.webContents.on('will-navigate', handleNavigation)
    window.webContents.on('will-redirect', handleNavigation)
    window.webContents.setWindowOpenHandler(({ url }) => {
        if (isAllowedNavigation(url)) {
            return { action: 'allow' }
        }

        void shell.openExternal(url)
        return { action: 'deny' }
    })
}

const getFreePort = () => new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
        const { port } = server.address()
        server.close(() => resolve(port))
    })
})

const startShellServer = async () => {
    const port = await getFreePort()
    shellOrigin = `http://127.0.0.1:${port}`
    shellServer = http.createServer(async (request, response) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.writeHead(405, { Allow: 'GET, HEAD' })
            response.end()
            return
        }

        const pathname = new URL(request.url || '/', shellOrigin).pathname
        const asset = SHELL_FILES[pathname]
        if (!asset) {
            response.writeHead(404)
            response.end('Not found')
            return
        }

        try {
            const content = await fs.readFile(path.join(__dirname, asset.file))
            response.writeHead(200, {
                'Cache-Control': 'no-store',
                'Content-Type': asset.contentType,
            })
            if (request.method === 'HEAD') {
                response.end()
            } else {
                response.end(content)
            }
        } catch (error) {
            response.writeHead(500)
            response.end('Unable to load the desktop shell')
            console.error(`[X] Failed to serve ${pathname}: ${error.message}`)
        }
    })

    await new Promise((resolve, reject) => {
        shellServer.once('error', reject)
        shellServer.listen(port, '127.0.0.1', resolve)
    })
}

const stopShellServer = async () => {
    if (!shellServer) {
        return
    }

    const currentServer = shellServer
    shellServer = null
    shellOrigin = null
    await new Promise(resolve => currentServer.close(resolve))
}

const createApplicationMenu = () => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        {
            label: 'File',
            submenu: [
                {
                    label: 'View Archive',
                    click: () => void openWindow(`${ARCHIVEBOX_ORIGIN}/public/`),
                },
                {
                    label: 'Add URLs',
                    click: () => void openWindow(`${ARCHIVEBOX_ORIGIN}/add/`),
                },
                { type: 'separator' },
                {
                    label: 'Quit ArchiveBox',
                    accelerator: process.platform === 'darwin' ? 'CmdOrCtrl+Q' : 'Alt+F4',
                    click: () => void quitApp(),
                },
            ],
        },
        {
            label: 'Archive',
            submenu: [
                {
                    label: 'View Archive',
                    click: () => void openWindow(`${ARCHIVEBOX_ORIGIN}/public/`),
                },
                {
                    label: 'Add URLs',
                    click: () => void openWindow(`${ARCHIVEBOX_ORIGIN}/add/`),
                },
                {
                    label: 'Manage Users',
                    click: () => void openWindow(`${ARCHIVEBOX_ORIGIN}/admin/auth/user/`),
                },
            ],
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
            ],
        },
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'togglefullscreen' },
            ],
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'ArchiveBox on GitHub',
                    click: () => void shell.openExternal('https://github.com/ArchiveBox/ArchiveBox'),
                },
            ],
        },
    ]))
}

const createWindow = async () => {
    if (mainWindow) {
        return mainWindow
    }

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        frame: false,
        show: false,
        backgroundColor: '#f7f8fc',
        webPreferences: {
            allowRunningInsecureContent: false,
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, 'preload.js'),
            sandbox: true,
            webSecurity: true,
        },
    })
    configureWindowSecurity(mainWindow)
    mainWindow.once('ready-to-show', () => mainWindow.show())
    mainWindow.on('closed', () => {
        mainWindow = null
    })

    return mainWindow
}

const openWindow = async url => {
    try {
        const window = await createWindow()
        const route = routeForUrl(url || `${ARCHIVEBOX_ORIGIN}/public/`)
        await window.loadURL(`${shellOrigin}/index.html?route=${encodeURIComponent(route)}`)
        window.focus()
    } catch (error) {
        console.error(`[X] Failed to open ArchiveBox window: ${error.message}`)
    }
}

ipcMain.on('window-close', event => {
    BrowserWindow.fromWebContents(event.sender)?.close()
})

ipcMain.on('window-maximize', event => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) {
        return
    }
    if (window.isMaximized()) {
        window.unmaximize()
    } else {
        window.maximize()
    }
})

ipcMain.on('window-minimize', event => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
})

const trayIcon = () => path.join(__dirname, 'icon.png')

const stopContainer = async () => {
    if (!container) {
        return
    }

    const currentContainer = container
    container = null
    updateTray()

    try {
        await callDocker(currentContainer, 'stop', { t: 5 })
    } catch (error) {
        if (![304, 404].includes(error.statusCode)) {
            console.error(`Unable to stop ArchiveBox container: ${error.message}`)
        }
    }

    try {
        await callDocker(currentContainer, 'remove', { force: true })
    } catch (error) {
        if (error.statusCode !== 404) {
            console.error(`Unable to remove ArchiveBox container: ${error.message}`)
        }
    }
}

const pullImage = async () => {
    docker = docker || createDockerClient({ timeout: 100000 })
    const pullStream = await callDocker(docker, 'pull', DOCKER_IMAGE)
    await followProgress(pullStream)
}

const waitForService = async () => {
    const deadline = Date.now() + 120000
    let lastError = null

    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${ARCHIVEBOX_ORIGIN}/`, {
                redirect: 'manual',
            })
            if (response.status >= 200 && response.status < 500) {
                return
            }
            lastError = new Error(`ArchiveBox returned HTTP ${response.status}`)
        } catch (error) {
            lastError = error
        }
        await new Promise(resolve => setTimeout(resolve, 1000))
    }

    throw lastError || new Error('Timed out waiting for ArchiveBox')
}

const startDocker = async () => {
    if (container) {
        return
    }

    try {
        console.log('[+] Connecting to Docker daemon...')
        docker = docker || createDockerClient({ timeout: 100000 })
        await callDocker(docker, 'ping')
        await fs.mkdir(DATA_DIR, { recursive: true })
        console.log('[+] Pulling Docker image...')
        await pullImage()

        const nextContainer = await callDocker(docker, 'createContainer', {
            AutoRemove: true,
            Cmd: DOCKER_CMD,
            ExposedPorts: {
                [`${BIND_PORT}/tcp`]: {},
            },
            HostConfig: {
                AutoRemove: true,
                Binds: [`${DATA_DIR}:/data`],
                PortBindings: {
                    [`${BIND_PORT}/tcp`]: [{
                        HostIp: '127.0.0.1',
                        HostPort: String(BIND_PORT),
                    }],
                },
            },
            Image: DOCKER_IMAGE,
            Tty: false,
            Volumes: {
                '/data': {},
            },
            name: process.env.ARCHIVEBOX_CONTAINER_NAME || `archivebox-desktop-${process.pid}`,
        })

        await callDocker(nextContainer, 'start')
        container = nextContainer
        console.log('[√] Started ArchiveBox Docker container')
        updateTray()
        await waitForService()
        await openWindow(`${ARCHIVEBOX_ORIGIN}/`)
    } catch (error) {
        console.error(`[X] Failed to start ArchiveBox: ${error.message}`)
        updateTray()
    }
}

const quitApp = async () => {
    quitting = true
    await stopContainer()
    await stopShellServer()
    app.quit()
}

const updateTray = () => {
    if (!tray) {
        return
    }

    const containerStatus = container ? 'running' : 'stopped'
    tray.setContextMenu(Menu.buildFromTemplate([
        {
            label: container ? 'Stop ArchiveBox' : 'Start ArchiveBox',
            click: () => {
                if (container) {
                    void stopContainer()
                } else {
                    void startDocker()
                }
            },
        },
        { label: `ArchiveBox is ${containerStatus}`, enabled: false },
        { type: 'separator' },
        {
            label: 'View Archive',
            click: () => void openWindow(`${ARCHIVEBOX_ORIGIN}/`),
        },
        {
            label: 'Add URLs',
            click: () => void openWindow(`${ARCHIVEBOX_ORIGIN}/add/`),
        },
        {
            label: 'Manage Users',
            click: () => void openWindow(`${ARCHIVEBOX_ORIGIN}/admin/auth/user/`),
        },
        { type: 'separator' },
        {
            label: 'Settings',
            click: async () => {
                const errorMessage = await shell.openPath(path.join(DATA_DIR, 'ArchiveBox.conf'))
                if (errorMessage) {
                    console.error(errorMessage)
                }
            },
        },
        {
            label: 'Update',
            click: async () => {
                try {
                    await pullImage()
                    console.log('[√] Updated ArchiveBox Docker image')
                } catch (error) {
                    console.error(`[X] Failed to update ArchiveBox: ${error.message}`)
                }
            },
        },
        {
            label: 'Quit',
            click: () => void quitApp(),
        },
    ]))
}

const createTray = () => {
    tray = new Tray(trayIcon())
    tray.setToolTip('ArchiveBox')
    if (process.platform === 'win32') {
        tray.on('click', () => tray.popUpContextMenu())
    }
    updateTray()
}

const bootstrap = async () => {
    if (require('electron-squirrel-startup')) {
        app.quit()
        return
    }

    if (!app.requestSingleInstanceLock()) {
        app.quit()
        return
    }

    if (process.platform === 'win32') {
        app.setAppUserModelId('com.archivebox.desktop')
    }

    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore()
            }
            mainWindow.show()
            mainWindow.focus()
        }
    })

    app.on('activate', () => {
        if (!mainWindow && container) {
            void openWindow(`${ARCHIVEBOX_ORIGIN}/`)
        }
    })

    app.on('window-all-closed', event => {
        if (tray && !quitting) {
            event.preventDefault()
        }
    })

    app.on('before-quit', event => {
        if (quitting || (!container && !shellServer)) {
            return
        }

        event.preventDefault()
        quitting = true
        void Promise.all([stopContainer(), stopShellServer()]).finally(() => app.quit())
    })

    await app.whenReady()

    await startShellServer()
    createApplicationMenu()
    createTray()
    void startDocker()
}

void bootstrap().catch(error => {
    console.error(`[X] ArchiveBox failed to start: ${error.stack || error.message}`)
    app.quit()
})
