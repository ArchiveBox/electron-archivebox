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
const IMAGE = 'archivebox/archivebox:dev'
const STARTUP_ONLY = process.argv.includes('--startup-only')
const USERNAME = 'archivebox'
const PASSWORD = 'archivebox-e2e-password'
const EMAIL = 'archivebox@example.com'
const REQUIRED_SCREENS = STARTUP_ONLY ? ['setup', 'docker-error'] : [
    'setup', 'startup', 'empty-archive', 'login', 'add-urls', 'add-options', 'activity', 'archive',
    'search', 'snapshot-overview', 'snapshot', 'archive-grid', 'tags', 'archive-log', 'manage-users', 'add-user', 'edit-user',
    'settings', 'stopped', 'restarted', 'docker-error',
]
const docker = STARTUP_ONLY ? null : createDockerClient({ timeout: 120000 })
const screenshots = []
const applications = new WeakMap()
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
const contentPage = async (electronApp, shellPage, port) => {
    const page = electronApp.context().pages().find(candidate => candidate !== shellPage && candidate.url().startsWith(`http://127.0.0.1:${port}/`))
    assert.ok(page, 'The real ArchiveBox WebContentsView is available to automation')
    page.setDefaultTimeout(30000)
    return page
}
const waitForRunning = async page => {
    await page.locator('#service-panel[data-state="running"], #service-panel[data-state="error"]').waitFor({ state: 'attached', timeout: 180000 })
    assert.equal(await page.locator('#service-panel').getAttribute('data-state'), 'running', await page.locator('#service-message').innerText())
}

// Read-only inspection is used for evidence. Every state transition below is a
// normal shipped UI action: no injected HTML, IPC calls, route changes or seeds.
const capture = async (page, id, title, description, checks) => {
    const file = `${id}.png`
    const electronApp = applications.get(page)
    const frame = electronApp.context().pages().find(candidate => candidate !== page && candidate.url().startsWith('http://127.0.0.1:'))
    // Let both renderers finish the paint requested by the preceding user action.
    for (const surface of [page, frame].filter(Boolean)) {
        await surface.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))))
    }
    const target = await electronApp.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        return { id: window.getMediaSourceId().split(':')[1], handle: window.getNativeWindowHandle().toString('hex'), bounds: window.getBounds() }
    })
    const filename = path.join(OUTPUT_DIR, file)
    if (process.platform === 'darwin') {
        execFileSync('/usr/sbin/screencapture', ['-x', '-o', '-l', target.id, filename])
    } else if (process.platform === 'linux') {
        execFileSync('import', ['-window', target.id, filename])
    } else if (process.platform === 'win32') {
        const handle = Buffer.from(target.handle, 'hex')
        const windowId = handle.length === 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE())
        const script = `
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class NativeCapture {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[NativeCapture]::SetProcessDPIAware() | Out-Null
$rect = New-Object NativeCapture+RECT
if (-not [NativeCapture]::GetWindowRect([IntPtr]::new(${windowId}), [ref]$rect)) { throw 'Cannot read the app window bounds' }
$bitmap = New-Object System.Drawing.Bitmap ($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
$bitmap.Save('${filename.replaceAll("'", "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
`
        execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
    } else {
        throw new Error(`Native window capture is unsupported on ${process.platform}`)
    }
    const png = await fs.readFile(filename)
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
    applications.set(page, electronApp)
    return { electronApp, page }
}

const login = async (page, frame) => {
    await frame.locator('input[name="username"]').fill(USERNAME)
    await frame.locator('input[name="password"]').fill(PASSWORD)
    await frame.locator('input[type="submit"], button[type="submit"]').first().click()
    await frame.locator('input[name="username"]').waitFor({ state: 'hidden' })
    await page.locator('[data-route="/add/"]').click()
    await frame.locator('#add-form').waitFor()
}

const captureRealScreens = async ({ dataDir, userDataDir, port, containerName }) => {
    const { electronApp, page } = await launch(dataDir, userDataDir, port, containerName)
    let frame
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
        frame = await contentPage(electronApp, page, port)
        await frame.locator('#table-bookmarks').waitFor()
        assert.equal(await frame.locator('#table-bookmarks .snapshot-row').count(), 0)
        await capture(page, 'empty-archive', 'Empty collection', 'The newly initialized collection is ready for its first saved page.', ['Live ArchiveBox public index', 'Zero snapshot rows'])

        await page.locator('[data-route="/add/"]').click()
        await frame.locator('input[name="username"]').waitFor()
        await capture(page, 'login', 'Sign in', 'ArchiveBox requires the administrator created during setup before adding pages.', ['Real authentication form reached by Add URLs'])
        await login(page, frame)
        await frame.locator('#id_url').fill('https://example.com\nhttps://example.org')
        await frame.getByPlaceholder('Add tag...').fill('desktop-demo')
        await frame.getByPlaceholder('Add tag...').press('Enter')
        await frame.locator('[data-preset="clear-all"]').click()
        const titleGroup = frame.locator('.plugin-group').filter({ has: frame.locator('input.plugin-section-toggle[value="title"]') })
        if (await titleGroup.getAttribute('open') === null) await titleGroup.locator('summary').click()
        for (const plugin of ['title', 'wget', 'screenshot']) await frame.locator(`input.plugin-section-toggle[value="${plugin}"]`).check()
        await frame.locator('#id_url').scrollIntoViewIfNeeded()
        await capture(page, 'add-urls', 'Add URLs', 'Two public websites are entered in the actual ArchiveBox form, with title, HTML and browser screenshot extraction selected.', ['Authenticated Add URLs form', 'Two entered URLs', 'Real title, wget and screenshot extractors selected'])
        await frame.locator('#submit').scrollIntoViewIfNeeded()
        await capture(page, 'add-options', 'Archive options', 'Scrolling the real Add URLs form reveals the parser, tags, depth, extraction methods and submit button.', ['Actual form scrolled to its lower controls', 'Title, wget and screenshot methods selected'])
        await frame.locator('#submit').click()
        await page.locator('[data-route="/admin/#progress-monitor"]').click()
        await frame.locator('#progress-monitor').waitFor()
        if (await frame.locator('#progress-monitor').getAttribute('class').then(value => value.includes('collapsed'))) await frame.locator('#progress-collapse').click()
        await frame.locator('#crawl-tree .crawl-item .status-badge.started').first().waitFor({ timeout: 180000 })
        await capture(page, 'activity', 'Live activity', 'The Activity button opens ArchiveBox’s live progress monitor while the submitted crawl runs real extractors.', ['Activity clicked in desktop toolbar', 'Live crawl state is started', 'Actual progress monitor receives running-job data'])
        await frame.locator('#idle-message').waitFor({ timeout: 180000 })
        await page.locator('[data-route="/public/"]').click()
        await frame.locator('#result_list tbody tr').filter({ hasText: 'https://example.com' }).locator('.field-title_str').filter({ hasText: 'Example Domain' }).waitFor({ timeout: 180000 })
        await frame.locator('#result_list tbody tr').filter({ hasText: 'https://example.org' }).locator('.field-title_str').filter({ hasText: 'Example Domain' }).waitFor({ timeout: 180000 })
        assert.equal(await frame.locator('#result_list tbody tr').count(), 2)
        await capture(page, 'archive', 'Saved pages', 'The collection lists two real pages saved through Add URLs, with extracted titles and tags.', ['Two real snapshot rows', 'Both extracted titles equal Example Domain', 'Tag desktop-demo visible'])

        await frame.locator('#searchbar').fill('example.com')
        await frame.locator('#searchbar').press('Enter')
        await frame.locator('#result_list tbody tr').nth(1).waitFor({ state: 'detached' })
        await frame.locator('#result_list tbody tr').filter({ hasText: 'https://example.com' }).waitFor()
        assert.equal(await frame.locator('#result_list tbody tr').count(), 1)
        await capture(page, 'search', 'Search the archive', 'Searching for example.com filters the two-page collection to one matching snapshot.', ['Search submitted using visible form', 'One matching result'])
        await frame.locator('.field-title_str a').filter({ hasText: 'Example Domain' }).click()
        await frame.locator('.header-url').filter({ hasText: 'https://example.com' }).waitFor()
        await frame.locator('.header-toggle').click()
        await frame.locator('a[target="preview"]').filter({ hasText: /wget/i }).waitFor()
        await capture(page, 'snapshot-overview', 'Snapshot details', 'The actual snapshot detail page shows saved files, metadata and extraction status for example.com.', ['Saved snapshot link opened', 'Snapshot URL matches example.com', 'Wget output available'])
        await frame.locator('a[target="preview"]').filter({ hasText: /wget/i }).click()
        await frame.locator('.header-toggle').click()
        await frame.frameLocator('iframe[name="preview"]').getByRole('heading', { name: 'Example Domain', exact: true }).waitFor({ timeout: 180000 })
        await capture(page, 'snapshot', 'Archived page', 'The snapshot viewer displays the HTML actually downloaded by wget from example.com.', ['Snapshot opened by its saved-page link', 'Wget HTML preview selected', 'Downloaded HTML renders Example Domain'])

        await page.locator('[data-route="/public/"]').click()
        await frame.getByRole('link', { name: 'Snapshots', exact: true }).click()
        await frame.locator('#result_list').waitFor()
        await frame.locator('#result_list').filter({ hasText: 'example.com' }).waitFor()
        await frame.getByRole('button', { name: 'Switch to grid view' }).click()
        await frame.locator('.card-thumbnail').first().waitFor()
        await capture(page, 'archive-grid', 'Snapshot grid', 'The grid toggle shows the saved pages with their real browser screenshots.', ['Snapshots navigation clicked', 'Grid view selected', 'Actual saved-page thumbnails displayed'])
        await frame.getByRole('link', { name: 'Tags', exact: true }).click()
        await frame.locator('#tag-card-grid .tag-card').filter({ hasText: 'desktop-demo' }).waitFor()
        await capture(page, 'tags', 'Manage tags', 'The Tags screen lists the tag assigned through the Add URLs form.', ['Tags link clicked', 'Persisted desktop-demo tag visible'])
        await frame.getByRole('link', { name: 'Log', exact: true }).click()
        await frame.locator('#result_list').filter({ hasText: 'wget' }).waitFor()
        await capture(page, 'archive-log', 'Archive results', 'The Log screen shows the actual title and wget extraction jobs for the saved pages.', ['Log link clicked', 'Real wget extraction results present'])

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
        await frame.locator('#result_list tbody tr').filter({ hasText: 'https://example.com' }).locator('.field-title_str').filter({ hasText: 'Example Domain' }).waitFor()
        assert.equal(await frame.locator('#result_list tbody tr').count(), 2)
        await capture(page, 'restarted', 'Collection after restart', 'Restarting the Docker service preserves both saved pages and their extracted titles.', ['Real service stop/start', 'Both saved pages survive restart'])
    } catch (error) {
        await capture(page, 'failure', 'Capture failure', error.message, []).catch(() => {})
        console.error(await page.locator('body').innerText().catch(() => ''))
        if (frame) console.error(await frame.locator('body').innerText().catch(() => ''))
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
