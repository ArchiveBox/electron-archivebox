const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('archivebox', Object.freeze({
    origin: `http://127.0.0.1:${process.env.ARCHIVEBOX_PORT || '8085'}`,
    platform: process.platform,
    window: Object.freeze({
        close: () => ipcRenderer.send('window-close'),
        maximize: () => ipcRenderer.send('window-maximize'),
        minimize: () => ipcRenderer.send('window-minimize'),
    }),
    versions: Object.freeze({
        chrome: process.versions.chrome,
        electron: process.versions.electron,
        node: process.versions.node,
    }),
}))
