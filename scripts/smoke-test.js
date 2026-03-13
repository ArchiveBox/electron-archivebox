const fs = require('fs')
const os = require('os')
const path = require('path')
const Docker = require('dockerode')

const docker = new Docker({ timeout: 120000 })

const IMAGE = 'archivebox/archivebox:latest'
const PORT = process.env.ARCHIVEBOX_SMOKE_PORT || '18085'
const CONTAINER_NAME = `archivebox-smoke-test-${process.pid}-${Date.now()}`
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'archivebox-smoke-'))

const callDocker = (ctx, method, ...args) => new Promise((resolve, reject) => {
    ctx[method](...args, (err, result) => err ? reject(err) : resolve(result))
})

const followProgress = (stream) => new Promise((resolve, reject) => {
    docker.modem.followProgress(stream, (err, output) => err ? reject(err) : resolve(output))
})

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const fetchWithTimeout = async (url, options = {}) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal,
            redirect: 'manual',
        })
    } finally {
        clearTimeout(timeout)
    }
}

const waitForEndpoint = async (url, validate, timeoutMs) => {
    const start = Date.now()
    let lastError = null

    while (Date.now() - start < timeoutMs) {
        try {
            const response = await fetchWithTimeout(url)
            if (validate(response)) {
                return response
            }
            lastError = new Error(`${url} returned unexpected status ${response.status}`)
        } catch (err) {
            lastError = err
        }
        await sleep(2000)
    }

    throw lastError || new Error(`Timed out waiting for ${url}`)
}

const assertResponse = async (url, validate, message) => {
    const response = await waitForEndpoint(url, validate, 120000)
    console.log(`✔ ${message} (${response.status})`)
    return response
}

const printContainerLogs = async (container) => {
    if (!container) {
        return
    }
    try {
        const logs = await callDocker(container, 'logs', {
            stdout: true,
            stderr: true,
            tail: 200,
        })
        const output = logs.toString('utf8').trim()
        if (output) {
            console.log('----- container logs -----')
            console.log(output)
            console.log('--------------------------')
        }
    } catch (err) {
        console.warn(`Unable to read container logs: ${err.message}`)
    }
}

const cleanup = async (container) => {
    if (container) {
        try {
            await callDocker(container, 'stop', { t: 0 })
        } catch (err) {
            if (err.statusCode !== 304 && err.statusCode !== 404) {
                console.warn(`Unable to stop container cleanly: ${err.message}`)
            }
        }
        try {
            await callDocker(container, 'remove', { force: true })
        } catch (err) {
            if (err.statusCode !== 404) {
                console.warn(`Unable to remove container cleanly: ${err.message}`)
            }
        }
    }

    try {
        fs.rmSync(DATA_DIR, { recursive: true, force: true })
    } catch (err) {
        console.warn(`Unable to remove temp data dir ${DATA_DIR}: ${err.message}`)
    }
}

const main = async () => {
    let container = null

    try {
        console.log('Checking Docker daemon...')
        await callDocker(docker, 'ping')

        console.log(`Pulling ${IMAGE} if needed...`)
        const stream = await callDocker(docker, 'pull', IMAGE)
        await followProgress(stream)

        console.log('Creating smoke-test ArchiveBox container...')
        container = await callDocker(docker, 'createContainer', {
            name: CONTAINER_NAME,
            Image: IMAGE,
            Cmd: ['archivebox', 'server', '--init', `0.0.0.0:${PORT}`],
            Tty: false,
            HostConfig: {
                Binds: [`${DATA_DIR}:/data`],
                PortBindings: {
                    [`${PORT}/tcp`]: [{ HostPort: PORT }],
                },
                AutoRemove: true,
            },
            Volumes: {
                '/data': {},
            },
            ExposedPorts: {
                [`${PORT}/tcp`]: {},
            },
        })

        await callDocker(container, 'start')
        console.log(`Started ${CONTAINER_NAME} on http://127.0.0.1:${PORT}`)

        await assertResponse(
            `http://127.0.0.1:${PORT}/`,
            (response) => response.status === 302 && response.headers.get('location') === '/public',
            'Archive index redirects to /public'
        )
        const publicPage = await assertResponse(
            `http://127.0.0.1:${PORT}/public/`,
            (response) => response.status === 200,
            'Public archive page loads'
        )
        const publicHtml = await publicPage.text()
        if (!publicHtml.includes('ArchiveBox')) {
            throw new Error('Public archive page did not contain ArchiveBox branding')
        }

        await assertResponse(
            `http://127.0.0.1:${PORT}/add/`,
            (response) => response.status === 302 && response.headers.get('location') === '/accounts/login/?next=/add/',
            'Add URLs page redirects to login when unauthenticated'
        )
        await assertResponse(
            `http://127.0.0.1:${PORT}/admin/auth/user/`,
            (response) => response.status === 302 && response.headers.get('location') === '/admin/login/?next=/admin/auth/user/',
            'Manage Users admin page redirects to admin login'
        )

        console.log('Smoke test completed successfully.')
    } catch (err) {
        console.error(`Smoke test failed: ${err.message}`)
        await printContainerLogs(container)
        process.exitCode = 1
    } finally {
        await cleanup(container)
    }
}

main()
