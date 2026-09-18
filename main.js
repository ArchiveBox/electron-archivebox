const { app, BrowserWindow, Menu, shell, Tray } = require('electron')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createDockerClient } = require('./docker-client')

const DATA_DIR = process.env.ARCHIVEBOX_DATA_DIR || path.join(os.homedir(), 'archivebox')
const BIND_HOST = '0.0.0.0'
const configuredPort = Number.parseInt(process.env.ARCHIVEBOX_PORT || '8085', 10)
const BIND_PORT = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 8085
const DOCKER_IMAGE = 'archivebox/archivebox:latest'
const DOCKER_CMD = ['archivebox', 'server', '--init', `${BIND_HOST}:${BIND_PORT}`]
const ARCHIVEBOX_ORIGIN = `http://127.0.0.1:${BIND_PORT}`
const APP_FILE_URL_PREFIX = pathToFileURL(__dirname).href

let mainWindow = null
let tray = null
let docker = null
let container = null
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
        if (parsedUrl.protocol === 'file:') {
            return parsedUrl.href.startsWith(APP_FILE_URL_PREFIX)
        }
        return parsedUrl.origin === ARCHIVEBOX_ORIGIN
    } catch {
        return false
    }
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

const createWindow = async () => {
    if (mainWindow) {
        return mainWindow
    }

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
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
        if (url) {
            await window.loadURL(url)
        }
        window.focus()
    } catch (error) {
        console.error(`[X] Failed to open ArchiveBox window: ${error.message}`)
    }
}

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
        if (quitting || !container) {
            return
        }

        event.preventDefault()
        quitting = true
        void stopContainer().finally(() => app.quit())
    })

    await app.whenReady()

    createTray()
    void startDocker()
}

void bootstrap().catch(error => {
    console.error(`[X] ArchiveBox failed to start: ${error.stack || error.message}`)
    app.quit()
})
