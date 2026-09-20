const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs/promises')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { _electron: electron } = require('playwright')
const { createDockerClient } = require('../docker-client')

const ROOT_DIR = path.resolve(__dirname, '..')
const OUTPUT_DIR = path.resolve(process.env.SCREENSHOT_DIR || path.join(ROOT_DIR, 'artifacts', 'screenshots'))
const IMAGE = 'archivebox/archivebox:latest'
const STARTUP_ONLY = process.argv.includes('--startup-only')
const USERNAME = 'archivebox'
const PASSWORD = 'archivebox-e2e-password'
const EMAIL = 'archivebox@example.com'
const REQUIRED_SCREENS = STARTUP_ONLY ? ['setup', 'docker-error'] : [
    'setup', 'startup', 'empty-archive', 'login', 'add-urls', 'archive',
    'search', 'snapshot', 'manage-users', 'add-user', 'edit-user',
    'settings', 'stopped', 'restarted', 'docker-error',
]
const docker = createDockerClient({ timeout: 120000 })
const screenshots = []
const callDocker = (object, method, ...args) => new Promise((resolve, reject) => {
    object[method](...args, (error, result) => error ? reject(error) : resolve(result))
})
const getFreePort = () => new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
        const { port } = server.address()
        server.close(() => resolve(port))
    })
})
const archiveFrame = page => page.frameLocator('#archivebox-frame')
const waitForRunning = async page => {
    await page.locator('#service-panel[data-state="running"], #service-panel[data-state="error"]').waitFor({ state: 'attached', timeout: 180000 })
    assert.equal(await page.locator('#service-panel').getAttribute('data-state'), 'running', await page.locator('#service-message').innerText())
}

// Read-only inspection is used for evidence. Every state transition below is a
// normal shipped UI action: no injected HTML, IPC calls, route changes or seeds.
const capture = async (page, id, title, description, checks) => {
    const file = `${id}.png`
    const png = await page.screenshot({ path: path.join(OUTPUT_DIR, file) })
    const frame = page.frames().find(frame => frame.parentFrame() === page.mainFrame())
    screenshots.push({
        id, file, title, description, checks,
        capturedAt: new Date().toISOString(),
        route: frame && frame.url() !== 'about:blank' ? new URL(frame.url()).pathname + new URL(frame.url()).search : null,
        width: png.readUInt32BE(16), height: png.readUInt32BE(20),
        sha256: createHash('sha256').update(png).digest('hex'),
    })
    console.log(`Captured ${file}: ${checks.join('; ')}`)
}

const launch = async (dataDir, userDataDir, port, containerName, extraEnv = {}) => {
    const electronApp = await electron.launch({
        ...(process.env.ELECTRON_EXECUTABLE ? { executablePath: process.env.ELECTRON_EXECUTABLE } : {}),
        args: [...(process.env.ELECTRON_EXECUTABLE ? [] : [path.join(ROOT_DIR, 'main.js')]), `--user-data-dir=${userDataDir}`],
        env: {
            ...process.env,
            ARCHIVEBOX_CONTAINER_NAME: containerName,
            ARCHIVEBOX_DATA_DIR: dataDir,
            ARCHIVEBOX_PORT: String(port),
            ...extraEnv,
        },
    })
    electronApp.process().stdout.on('data', data => process.stdout.write(data))
    electronApp.process().stderr.on('data', data => process.stderr.write(data))
    const page = await electronApp.firstWindow({ timeout: 30000 })
    page.setDefaultTimeout(30000)
    page.setDefaultNavigationTimeout(120000)
    return { electronApp, page }
}

const login = async page => {
    const frame = archiveFrame(page)
    await frame.locator('input[name="username"]').fill(USERNAME)
    await frame.locator('input[name="password"]').fill(PASSWORD)
    await frame.locator('input[type="submit"], button[type="submit"]').first().click()
    await frame.locator('#add-form').waitFor()
}

const captureRealScreens = async ({ dataDir, userDataDir, port, containerName }) => {
    const { electronApp, page } = await launch(dataDir, userDataDir, port, containerName)
    const frame = archiveFrame(page)
    try {
        await page.locator('#setup-form').waitFor()
        await capture(page, 'setup', 'First-run setup', 'The ordinary desktop app opens a fresh collection and asks for its administrator account.', ['New empty data directory', 'Visible administrator setup form'])
        await page.locator('#setup-username').fill(USERNAME)
        await page.locator('#setup-password').fill(PASSWORD)
        await page.locator('#setup-email').fill(EMAIL)
        await page.locator('#setup-submit').click()
        await page.locator('#service-panel').waitFor()
        await page.locator('#setup-form').waitFor({ state: 'hidden' })
        await capture(page, 'startup', 'Starting ArchiveBox', 'The app connects to Docker and initializes the collection after submitting the setup form.', ['Setup submitted through the visible form', 'Real service startup panel'])
        await waitForRunning(page)
        await frame.locator('#table-bookmarks').waitFor()
        assert.equal(await frame.locator('#table-bookmarks tbody tr').count(), 0)
        await capture(page, 'empty-archive', 'Empty collection', 'The newly initialized collection is ready for its first saved page.', ['Live ArchiveBox public index', 'Zero snapshot rows'])

        await page.locator('[data-route="/add/"]').click()
        await frame.locator('input[name="username"]').waitFor()
        await capture(page, 'login', 'Sign in', 'ArchiveBox requires the administrator created during setup before adding pages.', ['Real authentication form reached by Add URLs'])
        await login(page)
        await frame.locator('#id_url').fill('https://example.com\nhttps://example.org')
        await frame.locator('#id_tag').fill('desktop-demo')
        await frame.locator('#id_archive_methods').selectOption(['title', 'wget'])
        await capture(page, 'add-urls', 'Add URLs', 'Two public websites are entered in the actual ArchiveBox form, with title and HTML extraction selected.', ['Authenticated Add URLs form', 'Two entered URLs', 'Real title and wget extractors selected'])
        await frame.locator('#submit').click()
        // ArchiveBox submits a real archive job, then navigates to its index.
        await frame.locator('#in-progress, #stdout, #changelist').first().waitFor({ timeout: 180000 })
        await page.locator('[data-route="/public/"]').click()
        await frame.locator('[data-title-for="https://example.com"]').filter({ hasText: 'Example Domain' }).waitFor({ timeout: 180000 })
        await frame.locator('[data-title-for="https://example.org"]').filter({ hasText: 'Example Domain' }).waitFor({ timeout: 180000 })
        assert.equal(await frame.locator('#table-bookmarks tbody tr').count(), 2)
        await capture(page, 'archive', 'Saved pages', 'The collection lists two real pages saved through Add URLs, with extracted titles and tags.', ['Two real snapshot rows', 'Both extracted titles equal Example Domain', 'Tag desktop-demo visible'])

        await frame.locator('#searchbar').fill('example.com')
        await frame.locator('#changelist-search input[type="submit"]').click()
        await frame.locator('#table-bookmarks tbody tr').filter({ hasText: 'https://example.com' }).waitFor()
        await frame.locator('#table-bookmarks th').filter({ hasText: 'Snapshot (1)' }).waitFor()
        assert.equal(await frame.locator('#table-bookmarks tbody tr').count(), 1)
        await capture(page, 'search', 'Search the archive', 'Searching for example.com filters the two-page collection to one matching snapshot.', ['Search submitted using visible form', 'One matching result'])
        await frame.locator('.title-col a').filter({ hasText: 'Example Domain' }).click()
        await frame.locator('a[target="preview"]').filter({ hasText: 'Wget > HTML' }).click()
        await frame.frameLocator('iframe[name="preview"]').getByRole('heading', { name: 'Example Domain', exact: true }).waitFor({ timeout: 180000 })
        await capture(page, 'snapshot', 'Archived page', 'The snapshot viewer displays the HTML actually downloaded by wget from example.com.', ['Snapshot opened by its saved-page link', 'Wget HTML preview selected', 'Downloaded HTML renders Example Domain'])

        await page.locator('[data-route="/admin/auth/user/"]').click()
        await frame.locator('#result_list').waitFor()
        await frame.getByRole('link', { name: USERNAME, exact: true }).waitFor()
        await capture(page, 'manage-users', 'Manage users', 'Django administration lists the real account created during desktop setup.', ['Authenticated user administration', 'Setup administrator appears in results'])
        await frame.locator('a.addlink').filter({ hasText: 'Add user' }).click()
        await frame.locator('#id_username').fill('reader')
        await frame.locator('#id_password1').fill('reader-desktop-password')
        await frame.locator('#id_password2').fill('reader-desktop-password')
        await capture(page, 'add-user', 'Add a user', 'The real user creation form is filled before saving a second local account.', ['Django Add user form', 'New username entered through form fields'])
        await frame.locator('input[name="_save"]').click()
        await frame.locator('#id_email').waitFor()
        assert.equal(await frame.locator('#id_username').inputValue(), 'reader')
        await capture(page, 'edit-user', 'Edit a user', 'The newly saved reader account opens in the actual user editor.', ['User creation submitted', 'Persisted reader account in change form'])
        await frame.locator('#id_email').fill('reader@example.com')
        await frame.locator('input[name="_save"]').click()
        await frame.locator('#result_list').waitFor()
        await frame.locator('#result_list tr').filter({ hasText: 'reader@example.com' }).waitFor()

        await page.locator('#settings-button').click()
        await page.locator('#settings-panel').waitFor()
        await capture(page, 'settings', 'Desktop settings', 'The shipped settings panel shows the actual local collection and service controls.', ['Settings opened using toolbar', 'Live service controls visible'])
        await page.locator('#stop-service').click()
        await page.locator('#close-settings').click()
        await page.locator('#service-panel[data-state="stopped"]').waitFor()
        await capture(page, 'stopped', 'Service stopped', 'Stopping ArchiveBox from Settings shuts down its real Docker container.', ['Stop button clicked', 'App reports service stopped'])
        await page.locator('#start-service').click()
        await waitForRunning(page)
        await page.locator('[data-route="/public/"]').click()
        await frame.locator('[data-title-for="https://example.com"]').filter({ hasText: 'Example Domain' }).waitFor()
        assert.equal(await frame.locator('#table-bookmarks tbody tr').count(), 2)
        await capture(page, 'restarted', 'Collection after restart', 'Restarting the Docker service preserves both saved pages and their extracted titles.', ['Real service stop/start', 'Both saved pages survive restart'])
    } catch (error) {
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'failure.png') }).catch(() => {})
        console.error(await page.locator('body').innerText().catch(() => ''))
        console.error(await frame.locator('body').innerText().catch(() => ''))
        throw error
    } finally {
        await electronApp.close()
    }
}

const unavailableDockerHost = dataDir => process.platform === 'win32'
    ? `npipe:////./pipe/archivebox-unavailable-${process.pid}`
    : `unix://${path.join(dataDir, 'unavailable-docker.sock')}`

const captureDockerError = async options => {
    // A real connection failure, not an intercepted Docker response or UI flag.
    const { electronApp, page } = await launch(options.dataDir, options.userDataDir, options.port, options.containerName, {
        DOCKER_HOST: unavailableDockerHost(options.dataDir), DOCKER_CONTEXT: '',
    })
    try {
        await page.locator('#service-panel[data-state="error"]').waitFor()
        await page.locator('#start-service').waitFor()
        await capture(page, 'docker-error', 'Docker unavailable', 'Launching with a genuinely unavailable Docker endpoint displays the app’s normal recovery instructions.', ['Real connection failure at an unavailable local Docker socket', 'Shipped error and recovery UI'])
    } finally {
        await electronApp.close()
    }
}

const main = async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archivebox-electron-e2e-'))
    const dataDir = path.join(tempDir, 'data')
    const userDataDir = path.join(tempDir, 'profile')
    const port = await getFreePort()
    const containerName = `archivebox-electron-e2e-${process.pid}-${Date.now()}`
    await fs.mkdir(dataDir, { mode: 0o777 })
    await fs.chmod(dataDir, 0o777)
    await fs.rm(OUTPUT_DIR, { force: true, recursive: true })
    await fs.mkdir(OUTPUT_DIR, { recursive: true })
    try {
        if (STARTUP_ONLY) {
            const { electronApp, page } = await launch(dataDir, userDataDir, port, containerName, { DOCKER_HOST: unavailableDockerHost(dataDir), DOCKER_CONTEXT: '' })
            try {
                await page.locator('#setup-form').waitFor()
                await capture(page, 'setup', 'First-run setup', 'The packaged desktop app opens a fresh collection and requests its administrator account.', ['New empty data directory', 'Visible administrator setup form'])
                await page.locator('#setup-username').fill(USERNAME)
                await page.locator('#setup-password').fill(PASSWORD)
                await page.locator('#setup-email').fill(EMAIL)
                await page.locator('#setup-submit').click()
                await page.locator('#service-panel[data-state="error"]').waitFor()
                await capture(page, 'docker-error', 'Docker unavailable', 'A real unavailable local Docker socket displays the normal Docker installation and recovery guidance.', ['Setup submitted through visible form', 'Real connection failure at an unavailable local Docker socket', 'Shipped error and recovery UI'])
            } finally {
                await electronApp.close()
            }
        } else {
            await callDocker(docker, 'ping')
            await captureRealScreens({ containerName, dataDir, userDataDir, port })
            await captureDockerError({ containerName, dataDir, userDataDir, port })
        }
        const dockerImage = STARTUP_ONLY ? null : await callDocker(docker.getImage(IMAGE), 'inspect')
        assert.deepEqual(new Set(screenshots.map(screen => screen.id)), new Set(REQUIRED_SCREENS))
        const manifest = {
            schemaVersion: 1,
            captureScope: STARTUP_ONLY ? 'startup-only' : 'full',
            packaged: Boolean(process.env.ELECTRON_EXECUTABLE),
            generatedAt: new Date().toISOString(),
            commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT_DIR, encoding: 'utf8' }).trim(),
            dirty: Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: ROOT_DIR, encoding: 'utf8' }).trim()),
            workflowRun: process.env.GITHUB_RUN_ID ? {
                id: process.env.GITHUB_RUN_ID,
                url: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
            } : null,
            appVersion: require('../package.json').version,
            electronVersion: require('electron/package.json').version,
            playwrightVersion: require('playwright/package.json').version,
            platform: `${process.platform}-${process.arch}`,
            dockerImage: dockerImage ? { reference: IMAGE, id: dockerImage.Id, repoDigests: dockerImage.RepoDigests } : null,
            requiredScreenshots: REQUIRED_SCREENS,
            screenshots,
        }
        await fs.writeFile(path.join(OUTPUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
        console.log(`Verified ${screenshots.length} real desktop screens. Manifest: ${path.join(OUTPUT_DIR, 'manifest.json')}`)
    } finally {
        try {
            if (!STARTUP_ONLY) await callDocker(docker.getContainer(containerName), 'remove', { force: true })
        } catch (error) {
            if (error.statusCode !== 404) console.warn(`Container cleanup: ${error.message}`)
        }
        // CI's Docker files are owned by the container user; retain the isolated
        // folder on a permissions failure rather than broad host-side deletion.
        await fs.rm(tempDir, { force: true, recursive: true }).catch(error => console.warn(`Temporary collection retained at ${tempDir}: ${error.message}`))
    }
}

main().catch(error => {
    console.error(`Real Electron screenshot capture failed: ${error.stack || error.message}`)
    process.exitCode = 1
})
