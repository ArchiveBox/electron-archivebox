const fs = require('node:fs/promises')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { _electron: electron } = require('playwright')
const { createDockerClient } = require('../docker-client')

const ROOT_DIR = path.resolve(__dirname, '..')
const OUTPUT_DIR = path.resolve(process.env.SCREENSHOT_DIR || path.join(ROOT_DIR, 'artifacts', 'screenshots'))
const IMAGE = 'archivebox/archivebox:latest'
const USERNAME = 'archivebox'
const PASSWORD = 'archivebox-e2e-password'
const EMAIL = 'archivebox@example.com'

const docker = createDockerClient({ timeout: 120000 })

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
        const cleanupCommand = process.platform === 'win32'
            ? 'rm -rf /data/* /data/.[!.]*'
            : `rm -rf /data/* /data/.[!.]*; chown ${process.getuid?.() || 0}:${process.getgid?.() || 0} /data`
        await runContainerCommand(
            dataDir,
            `archivebox-cleanup-${process.pid}`,
            ['-lc', cleanupCommand],
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

const archiveFrame = page => page.frameLocator('#archivebox-frame')

const login = async (page, origin) => {
    const frame = archiveFrame(page)
    await frame.locator('input[name="username"]').waitFor({ timeout: 120000 })
    await frame.locator('input[name="username"]').fill(USERNAME)
    await frame.locator('input[name="password"]').fill(PASSWORD)
    await frame.locator('input[type="submit"], button[type="submit"]').first().click()

    try {
        await frame.locator('#add-form').waitFor({ timeout: 30000 })
    } catch (error) {
        if (await frame.locator('#login-form').count()) {
            const body = await frame.locator('body').innerText().catch(() => '')
            throw new Error(`ArchiveBox login failed:\n${body}`, { cause: error })
        }

        await page.locator('#archivebox-frame').evaluate((frameElement, addRoute) => {
            frameElement.src = addRoute
        }, `${origin}/add/`)
        await frame.locator('body').waitFor({ timeout: 120000 })
        await frame.locator('#add-form').waitFor({ timeout: 120000 })
        return
    }

    if (!(await frame.locator('#add-form').count())) {
        const body = await frame.locator('body').innerText().catch(() => '')
        console.error(`ArchiveBox login did not reach the add form:\n${body}`)
    }
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
        await page.locator('#archivebox-frame').waitFor({ state: 'attached', timeout: 180000 })
        await archiveFrame(page).locator('body').waitFor({ timeout: 180000 })
        await page.screenshot({
            animations: 'disabled',
            fullPage: true,
            path: path.join(OUTPUT_DIR, 'archive.png'),
        })

        await page.locator('[data-route="/add/"]').click()
        await archiveFrame(page).locator('body').waitFor({ timeout: 120000 })
        await login(page, origin)
        await archiveFrame(page).locator('#id_url').fill('https://example.org')
        const archiveMethods = archiveFrame(page).locator('#id_archive_methods')
        if (await archiveMethods.count()) {
            await archiveMethods.selectOption('title')
        }
        await page.screenshot({
            animations: 'disabled',
            fullPage: true,
            path: path.join(OUTPUT_DIR, 'add-urls.png'),
        })

        await archiveFrame(page).locator('#submit').click()
        await archiveFrame(page).locator('#stdout').waitFor({ timeout: 180000 })

        await page.locator('[data-route="/admin/auth/user/"]').click()
        await archiveFrame(page).locator('body').waitFor({ timeout: 120000 })
        await archiveFrame(page).locator('#content-main').waitFor({ timeout: 120000 })
        await page.screenshot({
            animations: 'disabled',
            fullPage: true,
            path: path.join(OUTPUT_DIR, 'manage-users.png'),
        })

        await page.locator('[data-route="/public/"]').click()
        await archiveFrame(page).locator('body').waitFor({ timeout: 120000 })
        const snapshotLinks = archiveFrame(page).locator('a[href*="/archive/"]')
        await snapshotLinks.first().waitFor({ timeout: 120000 })
        const snapshotHref = await snapshotLinks.evaluateAll(links => links
            .map(link => link.getAttribute('href'))
            .find(href => href && /^\/archive\/[^/]+\/index\.html$/.test(href)))
        if (!snapshotHref) {
            throw new Error('The real ArchiveBox collection did not expose a snapshot link')
        }
        await page.locator('#archivebox-frame').evaluate((frame, href) => {
            frame.src = href
        }, new URL(snapshotHref, origin).href)
        await archiveFrame(page).locator('body').waitFor({ timeout: 120000 })
        await page.screenshot({
            animations: 'disabled',
            fullPage: true,
            path: path.join(OUTPUT_DIR, 'snapshot.png'),
        })
        console.log('Captured full-window archive, add, admin, and snapshot screens')
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
