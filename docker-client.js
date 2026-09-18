const Docker = require('dockerode')

const createDockerClient = options => {
    const dockerHost = process.env.DOCKER_HOST
    if (!dockerHost) {
        return new Docker(options)
    }

    if (dockerHost.startsWith('npipe://') || dockerHost.startsWith('unix://')) {
        return new Docker({
            ...options,
            socketPath: dockerHost.replace(/^[^:]+:\/\//, ''),
        })
    }

    const host = new URL(dockerHost)
    return new Docker({
        ...options,
        host: host.hostname,
        port: Number(host.port || 2375),
        protocol: host.protocol.slice(0, -1),
    })
}

module.exports = { createDockerClient }
