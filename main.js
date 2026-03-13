const { app, Menu, Tray, BrowserWindow, shell } = require('electron')
const Docker = require('dockerode')
const path = require('path')
const os = require('os')

if (require('electron-squirrel-startup')) {
    app.quit()
}

// constants
const DATA_DIR = path.join(os.homedir(), 'archivebox')
const BIND_HOST = '0.0.0.0'
const BIND_PORT = '8085'
// const DOCKER_IMAGE = 'ubuntu'
// const DOCKER_CMD = ['uname', '-a']
const DOCKER_IMAGE = 'archivebox/archivebox:latest'
const DOCKER_CMD = ['archivebox', 'server', '--init', `0.0.0.0:${BIND_PORT}`]

// globals are bad mmmkay kids
let WINDOW = null
let TRAY = null
let DOCKER = null
let CONTAINER = null


const openWindow = (url) => {
    console.log(`[+] Opening ${url} in main window...`)
    if (!WINDOW) {
        WINDOW = new BrowserWindow({
            width: 800,
            height: 600,
            titleBarStyle: 'hidden',
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                preload: path.join(__dirname, 'preload.js')
            },
        })
        WINDOW.on('closed', () => {
            WINDOW = null
        })
    }
    // Open the DevTools.
    // WINDOW.webContents.openDevTools()
    WINDOW.loadURL(url)
    WINDOW.focus()
}

const createTray = () => {
    TRAY = TRAY || new Tray(path.join(__dirname, trayIcon()))
    if (process.platform === 'win32') {
        TRAY.on('click', () => TRAY.popUpContextMenu())
    }
    TRAY.setToolTip('ArchiveBox')
}

const trayIcon = () => {
    return 'icon.png'
}

const updateTray = () => {
    const container_status = CONTAINER ? 'running' : 'stopped'

    TRAY.setContextMenu(Menu.buildFromTemplate([
        { label: CONTAINER ? 'Stop ArchiveBox' : 'Start ArchiveBox', click() { 
            if (CONTAINER) {
                CONTAINER.kill(function() {
                    CONTAINER.remove()
                    CONTAINER = null
                })
            } else {
                startDocker()
            }
        } },
        { label: `ArchiveBox is ${container_status}`, enabled: false },
        { type: 'separator' },
        { label: 'View Archive', click() { 
            openWindow(`http://127.0.0.1:${BIND_PORT}/`)
        } },
        { label: 'Add URLs', click() { 
            openWindow(`http://127.0.0.1:${BIND_PORT}/add/`)
        } },
        { label: 'Manage Users', click() { 
            openWindow(`http://127.0.0.1:${BIND_PORT}/admin/auth/user/`)
        } },
        { type: 'separator' },
        { label: 'Settings', async click() {
            const errorMessage = await shell.openPath(path.join(DATA_DIR, 'ArchiveBox.conf'))
            if (errorMessage) {
                console.error(errorMessage)
            }
        } },
        { label: 'Update', click() { 
            if (!CONTAINER) {
                startDocker()
            }
            DOCKER.pull('archivebox/archivebox', function (err, stream) {
                stream.pipe(process.stdout)
            });
        } },
        { label: 'Quit', click() {
            if (CONTAINER) {
                console.log('[X] Stopping ArchiveBox docker container...')
                CONTAINER.kill(function() {
                    CONTAINER.remove()
                    CONTAINER = null
                    console.log('[X] Stopping ArchiveBox app gracefully...')
                    app.quit()
                })
            } else {
                console.log('[X] Stopping ArchiveBox app gracefully...')
                app.quit()
            }
        } },
    ]))
}

const startDocker = () => {
    console.log('[+] Connecting to Docker daemon...')
    DOCKER = DOCKER || new Docker({timeout: 100000})
    // console.log(DOCKER)
    console.log('[+] Pulling docker container...')
    DOCKER.pull(DOCKER_IMAGE, function (err, pull_stream) {

        if (err) {
            console.error('Failed to connect to Docker:');
            return console.error(err);
        }

        pull_stream.pipe(process.stdout)
        DOCKER.modem.followProgress(pull_stream, () => {
            console.log('[+] Creating docker container...')
            DOCKER.createContainer(
                {
                    'name': 'archivebox',
                    'Image': DOCKER_IMAGE,
                    'Cmd': DOCKER_CMD,
                    'Tty': true,
                    'HostConfig': {
                        'Binds': [`${DATA_DIR}:/data`],
                        "PortBindings": {
                            [`${BIND_PORT}/tcp`]: [{ "HostPort": BIND_PORT }],
                        },
                    },
                    'Volumes': {
                        '/data': {}
                    },
                    "ExposedPorts": {
                        [`${BIND_PORT}/tcp`]: {},
                    },
                    'AutoRemove': true,
                },
                function(err, container) {
                    console.log('[+] Starting docker container...')
                    console.log()
                    if (err) {
                        return console.error(err);
                    }
                    container.attach({stream: true, stdout: true, stderr: true}, function (err, run_stream) {
                        run_stream.pipe(process.stdout);
                    })
                    container.start(function (err, data) {
                        CONTAINER = container
                        console.log('[√] Started ArchiveBox Docker container')
                        updateTray()
                    })
                },
            )
        })
    });
}


// launch init code, subprocesses, etc. here
console.log('[+] Starting ArchiveBox...')

// dont quit the app when main window is closed
app.on('window-all-closed', event => {
    event.preventDefault()
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {

    console.log('[+] Starting ArchiveBox tray icon...')
    createTray()
    updateTray()
    // if (app.dock) app.dock.hide()
    
    // createWindow()
    // WINDOW.loadFile('index.html') 
    startDocker()
})


// create a container entity. does not query API
// var container = docker.getContainer('71501a8ab0f8')

// // query API for container info
// container.inspect(function (err, data) {
//   console.log(data)
// })

// container.start(function (err, data) {
//   console.log(data)
// })

// container.remove(function (err, data) {
//   console.log(data)
// })
