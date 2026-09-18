const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('archivebox', Object.freeze({
    platform: process.platform,
    versions: Object.freeze({
        chrome: process.versions.chrome,
        electron: process.versions.electron,
        node: process.versions.node,
    }),
}))
