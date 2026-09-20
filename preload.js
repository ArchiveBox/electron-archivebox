const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('archivebox', Object.freeze({
    getState: () => ipcRenderer.invoke('service-state'),
    action: (action, credentials) => ipcRenderer.invoke('service-action', action, credentials),
    onState: callback => ipcRenderer.on('service-state', (_event, state) => callback(state)),
    onNavigate: callback => ipcRenderer.on('navigate', (_event, route) => callback(route)),
    openMenu: label => ipcRenderer.send('menu-open', label),
    window: Object.freeze({
        close: () => ipcRenderer.send('window-close'),
        maximize: () => ipcRenderer.send('window-maximize'),
        minimize: () => ipcRenderer.send('window-minimize'),
    }),
}))
