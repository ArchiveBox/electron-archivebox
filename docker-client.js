const Docker = require('dockerode')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const configuredDockerHost = () => {
    if (process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT) return process.env.DOCKER_HOST
    const configDir = process.env.DOCKER_CONFIG || path.join(os.homedir(), '.docker')
    let context = process.env.DOCKER_CONTEXT
    if (!context) {
        try { context = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8')).currentContext }
        catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    if (!context || context === 'default') return null
    const metadataDir = path.join(configDir, 'contexts', 'meta')
    for (const entry of fs.readdirSync(metadataDir)) {
        const metadata = JSON.parse(fs.readFileSync(path.join(metadataDir, entry, 'meta.json'), 'utf8'))
        if (metadata.Name === context) return metadata.Endpoints?.docker?.Host
    }
    throw new Error(`Docker context "${context}" was not found. Select a local Docker context and try again.`)
}
const createDockerClient = options => {
    const host = configuredDockerHost()
    if (!host) return new Docker(options)
    if (host.startsWith('npipe://') || host.startsWith('unix://')) {
        return new Docker({ ...options, socketPath: host.replace(/^[^:]+:\/\//, '') })
    }
    throw new Error('ArchiveBox Desktop needs a local Docker engine. Select Docker Desktop or a local Docker context.')
}
module.exports = { createDockerClient }
