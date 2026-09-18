const fs = require('node:fs/promises')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const Docker = require('dockerode')
const { _electron: electron } = require('playwright')

const ROOT_DIR = path.resolve(__dirname, '..')
const OUTPUT_DIR = path.resolve(process.env.SCREENSHOT_DIR || path.join(ROOT_DIR, 'artifacts', 'screenshots'))
const IMAGE = 'archivebox/archivebox:latest'
const USERNAME = 'archivebox'
const PASSWORD = 'archivebox-e2e-password'
const EMAIL = 'archivebox@example.com'

const docker = new Docker({ timeout: 120000 })

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

const getFreePort = () => new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
        const { port } = server.address()
        server.close(() => resolve(port))
    })
})

const runContainerCommand = async (dataDir, name, cmd, env = {}, user, entrypoint) => {
    const commandContainer = await callDocker(docker, 'createContainer', {
        Cmd: cmd,
        Env: Object.entries(env).map(([key, value]) => `${key}=${value}`),
        HostConfig: {
            AutoRemove: false,
            Binds: [`${dataDir}:/data`],
        },
        Image: IMAGE,
        name,
        Tty: false,
        ...(entrypoint ? { Entrypoint: entrypoint } : {}),
        ...(user ? { User: user } : {}),
    })

    try {
        await callDocker(commandContainer, 'start')
        const result = await callDocker(commandContainer, 'wait')
        const logs = await callDocker(commandContainer, 'logs', {
            stderr: true,
            stdout: true,
        })
        const output = logs.toString('utf8')
        if (result.StatusCode !== 0) {
            throw new Error(`Container command failed (${cmd.join(' ')}):\n${output}`)
        }
        return output
    } finally {
        try {
            await callDocker(commandContainer, 'remove', { force: true })
        } catch (error) {
            if (error.statusCode !== 404) {
                console.warn(`Unable to remove setup container ${name}: ${error.message}`)
            }
        }
    }
}

const runArchiveBoxCommand = (dataDir, name, args, env = {}, user) => runContainerCommand(
    dataDir,
    name,
    ['archivebox', ...args],
    env,
    user
)

const prepareCollection = async dataDir => {
    console.log('Checking Docker daemon...')
    await callDocker(docker, 'ping')
    console.log(`Pulling ${IMAGE} if needed...`)
    await followProgress(await callDocker(docker, 'pull', IMAGE))

    console.log('Initializing a real ArchiveBox collection...')
    await runArchiveBoxCommand(dataDir, `archivebox-init-${process.pid}`, ['init', '--quick'])
    await runArchiveBoxCommand(
        dataDir,
        `archivebox-user-${process.pid}`,
        ['manage', 'createsuperuser', '--noinput', '--username', USERNAME, '--email', EMAIL],
        { DJANGO_SUPERUSER_PASSWORD: PASSWORD }
    )
    console.log('Seeding a real ArchiveBox snapshot...')
    await runArchiveBoxCommand(
        dataDir,
        `archivebox-seed-${process.pid}`,
        ['add', '--depth=0', '--extract=title', 'https://example.com']
    )
}

const cleanupDataDir = async dataDir => {
    try {
        await runContainerCommand(
            dataDir,
            `archivebox-cleanup-${process.pid}`,
            ['-lc', `rm -rf /data/* /data/.[!.]*; chown ${process.getuid?.() || 0}:${process.getgid?.() || 0} /data`],
            {},
            '0:0',
            ['/bin/sh']
        )
    } catch (error) {
        console.warn(`Unable to clean up Docker-owned collection files: ${error.message}`)
    }

    try {
        await fs.rm(dataDir, { force: true, recursive: true })
    } catch (error) {
        console.warn(`Unable to remove temporary collection ${dataDir}: ${error.message}`)
    }
}

const login = async (page, origin) => {
    await page.goto(`${origin}/accounts/login/?next=/add/`)
    await page.locator('input[name="username"]').fill(USERNAME)
    await page.locator('input[name="password"]').fill(PASSWORD)
    await page.locator('input[type="submit"], button[type="submit"]').first().click()
    await page.waitForURL(url => !url.pathname.includes('/login/'), { timeout: 120000 })
    await page.goto(`${origin}/add/`)
    await page.waitForSelector('#add-form', { timeout: 120000 })
}

const captureRealScreens = async ({ dataDir, port, containerName }) => {
    const origin = `http://127.0.0.1:${port}`
    const electronApp = await electron.launch({
        args: [path.join(ROOT_DIR, 'main.js')],
        env: {
            ...process.env,
            ARCHIVEBOX_CONTAINER_NAME: containerName,
            ARCHIVEBOX_DATA_DIR: dataDir,
            ARCHIVEBOX_PORT: String(port),
        },
    })

    try {
        const page = await electronApp.firstWindow({ timeout: 180000 })
        await page.waitForURL(url => url.origin === origin && url.pathname.startsWith('/public'), {
            timeout: 180000,
        })
        await page.screenshot({
            animations: 'disabled',
            path: path.join(OUTPUT_DIR, 'archive.png'),
        })

        await login(page, origin)
        await page.locator('#id_url').fill('https://example.org')
        const archiveMethods = page.locator('#id_archive_methods')
        if (await archiveMethods.count()) {
            await archiveMethods.selectOption('title')
        }
        await page.screenshot({
            animations: 'disabled',
            path: path.join(OUTPUT_DIR, 'add-urls.png'),
        })

        await page.locator('#submit').click()
        await page.waitForSelector('#stdout', { timeout: 180000 })

        await page.goto(`${origin}/admin/auth/user/`)
        await page.waitForSelector('#content-main', { timeout: 120000 })
        await page.screenshot({
            animations: 'disabled',
            path: path.join(OUTPUT_DIR, 'manage-users.png'),
        })

        await page.goto(`${origin}/public/`)
        const snapshotHref = await page.locator('a[href*="/archive/"]').evaluateAll(links => links
            .map(link => link.getAttribute('href'))
            .find(href => href && /^\/archive\/\d+\/index\.html$/.test(href)))
        if (!snapshotHref) {
            throw new Error('The real ArchiveBox collection did not expose a snapshot link')
        }
        await page.goto(new URL(snapshotHref, origin).href)
        await page.waitForLoadState('domcontentloaded')
        await page.screenshot({
            animations: 'disabled',
            path: path.join(OUTPUT_DIR, 'snapshot.png'),
        })
        console.log('Captured real ArchiveBox archive, add, admin, and snapshot screens')
    } finally {
        await electronApp.close()
    }
}

const main = async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archivebox-electron-e2e-'))
    const port = await getFreePort()
    const containerName = `archivebox-electron-e2e-${process.pid}-${Date.now()}`

    await fs.rm(OUTPUT_DIR, { force: true, recursive: true })
    await fs.mkdir(OUTPUT_DIR, { recursive: true })
    await fs.chmod(dataDir, 0o777)

    try {
        await prepareCollection(dataDir)
        await captureRealScreens({ containerName, dataDir, port })
    } finally {
        await cleanupDataDir(dataDir)
    }
}

main().catch(error => {
    console.error(`Real Electron screenshot capture failed: ${error.stack || error.message}`)
    process.exitCode = 1
})
