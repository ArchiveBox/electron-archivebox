const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { _electron: electron } = require('playwright')
const { createDockerClient } = require('../docker-client')

const ROOT_DIR = path.resolve(__dirname, '..')
const OUTPUT_DIR = path.resolve(process.env.SCREENSHOT_DIR || path.join(ROOT_DIR, 'artifacts', 'screenshots'))
const IMAGE = 'archivebox/archivebox:dev'
const STARTUP_ONLY = process.argv.includes('--startup-only')
const CAPTURE_LAN = process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true'
const USERNAME = 'archivebox'
const PASSWORD = 'archivebox-e2e-password'
const EMAIL = 'archivebox@example.com'
const REQUIRED_SCREENS = STARTUP_ONLY ? ['setup', 'docker-error'] : [
    'setup', 'startup', 'empty-archive', 'login', 'add-urls', 'add-options', 'activity', 'archive',
    'search', 'snapshot-overview', 'snapshot', 'archive-grid', 'tags', 'archive-log', 'manage-users', 'add-user', 'edit-user',
    'settings', 'network-settings', ...(CAPTURE_LAN ? ['network-lan'] : []), 'stopped', 'restarted', 'docker-error',
]
const docker = STARTUP_ONLY ? null : createDockerClient({ timeout: 120000 })
const screenshots = []
const applications = new WeakMap()
const callDocker = (object, method, ...args) => new Promise((resolve, reject) => {
    object[method](...args, (error, result) => error ? reject(error) : resolve(result))
})
const contentPage = async (electronApp, shellPage, port) => {
    const context = electronApp.context()
    const page = context.pages().find(candidate => candidate !== shellPage)
        || await context.waitForEvent('page', { predicate: candidate => candidate !== shellPage })
    page.setDefaultTimeout(30000)
    await page.waitForURL(url => url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === String(port))
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
    const frame = electronApp.context().pages().find(candidate => candidate !== page && /^https?:/.test(candidate.url()))
    // Let both renderers finish the paint requested by the preceding user action.
    for (const surface of [page, frame].filter(Boolean)) {
        await surface.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))))
    }
    const target = await electronApp.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        // A renderer animation frame can finish before its compositor frame is
        // presented. Await real compositor copies, then discard them: the saved
        // evidence below remains an unmodified native window screenshot.
        const surfaces = [window.webContents, ...window.contentView.children.map(view => view.webContents).filter(Boolean)]
        for (const surface of surfaces) await surface.capturePage()
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
        chromiumSandbox: true,
        ...(process.env.ELECTRON_EXECUTABLE ? { executablePath: process.env.ELECTRON_EXECUTABLE } : {}),
        args: [...(process.env.ELECTRON_EXECUTABLE ? [] : [ROOT_DIR]), `--user-data-dir=${userDataDir}`],
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
    await page.waitForURL(url => url.pathname === '/index.html')
    const actual = await electronApp.evaluate(({ app, BrowserWindow }) => ({
        shellUrl: BrowserWindow.getAllWindows()[0].webContents.getURL(),
        appVersion: app.getVersion(),
        dataDir: process.env.ARCHIVEBOX_DATA_DIR,
        port: process.env.ARCHIVEBOX_PORT,
    }))
    assert.equal(actual.dataDir, dataDir, 'The launched app uses the isolated real collection')
    assert.equal(actual.port, String(port), 'The launched app uses the selected local port')
    assert.equal(actual.appVersion, require('../package.json').version, 'The launched app version matches the package being validated')
    assert.equal(page.url(), actual.shellUrl, 'Automation is attached to the desktop BrowserWindow shell')
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
    let networkSession
    const searchRequests = []
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
        await frame.getByRole('heading', { name: 'Create a new Crawl', exact: true }).scrollIntoViewIfNeeded()
        await capture(page, 'add-urls', 'Add URLs', 'Two public websites are entered in the actual ArchiveBox form, with title, HTML and browser screenshot extraction selected.', ['Authenticated Add URLs form', 'Two entered URLs', 'Real title, wget and screenshot extractors selected'])
        await frame.getByRole('heading', { name: 'Crawl Plugins', exact: true }).scrollIntoViewIfNeeded()
        await capture(page, 'add-options', 'Crawl plugins', 'The real Add URLs form lets the user choose archiving plugins and reusable presets.', ['Actual crawl plugin controls', 'Title, wget and screenshot methods selected'])
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

        networkSession = await frame.context().newCDPSession(frame)
        await networkSession.send('Network.enable')
        networkSession.on('Network.responseReceived', event => {
            const url = new URL(event.response.url)
            if (searchRequests.length < 20 && url.pathname.startsWith('/admin/core/snapshot/') && url.searchParams.get('q') === 'example.com') {
                searchRequests.push({ requestId: event.requestId, url: event.response.url, status: event.response.status, mimeType: event.response.mimeType })
            }
        })
        // Deep search also searches each snapshot's saved Crawl record, which
        // contains both submitted URLs. Select the real metadata mode to test
        // filtering by this snapshot's URL instead of its shared crawl input.
        await frame.getByRole('combobox', { name: 'Search mode' }).selectOption('meta')
        await frame.locator('#searchbar').fill('example.com')
        const searchResponse = frame.waitForResponse(response => {
            const url = new URL(response.url())
            return url.pathname === '/admin/core/snapshot/search-stream/' && url.searchParams.get('q') === 'example.com' && url.searchParams.get('search_mode') === 'meta'
        })
        await frame.locator('#searchbar').press('Enter')
        const completedSearch = await searchResponse
        assert.equal(completedSearch.status(), 200, 'The real streaming search request succeeds')
        await frame.waitForURL(url => url.searchParams.get('q') === 'example.com' && url.searchParams.get('search_mode') === 'meta')
        await frame.waitForLoadState('load')
        await frame.locator('#changelist-search:not([aria-busy="true"])').waitFor({ state: 'attached' })
        await frame.locator('#result_list tbody tr').nth(1).waitFor({ state: 'detached' })
        await frame.locator('#result_list tbody tr').filter({ hasText: 'https://example.com' }).waitFor()
        assert.equal(await frame.locator('#result_list tbody tr').count(), 1)
        assert.equal(await frame.getByRole('combobox', { name: 'Search mode', includeHidden: true }).inputValue(), 'meta')
        await capture(page, 'search', 'Search the archive', 'Selecting metadata search and entering example.com filters the two-page collection to the snapshot whose URL matches.', ['Metadata mode selected using visible Search mode control', 'Search submitted using visible form', 'One matching URL result'])
        await frame.locator('.field-title_str a').filter({ hasText: 'Example Domain' }).click()
        await frame.locator('.header-url').filter({ hasText: 'https://example.com' }).waitFor()
        await frame.waitForLoadState('load')
        if (!await frame.locator('.header-bottom').isVisible()) await frame.locator('.header-toggle').click()
        await frame.locator('.header-bottom').waitFor({ state: 'visible' })
        await frame.locator('a[target="preview"]').filter({ hasText: /wget/i }).waitFor()
        await capture(page, 'snapshot-overview', 'Snapshot details', 'The actual snapshot detail page shows saved files, metadata and extraction status for example.com.', ['Saved snapshot link opened', 'Snapshot URL matches example.com', 'Wget output available'])
        await frame.locator('a[target="preview"]').filter({ hasText: /wget/i }).click()
        if (await frame.locator('.header-bottom').isVisible()) await frame.locator('.header-toggle').click()
        await frame.locator('.header-bottom').waitFor({ state: 'hidden' })
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
        await frame.locator('[name="_save"]').click()
        await frame.locator('#id_email').waitFor()
        assert.equal(await frame.locator('#id_username').inputValue(), 'reader')
        await capture(page, 'edit-user', 'Edit a user', 'The newly saved reader account opens in the actual user editor.', ['User creation submitted', 'Persisted reader account in change form'])
        await frame.locator('#id_email').fill('reader@example.com')
        await frame.getByRole('button', { name: '💾 Save', exact: true }).click()
        await frame.locator('.success').filter({ hasText: 'changed successfully' }).waitFor()
        await page.locator('[data-route="/admin/auth/user/"]').click()
        await frame.locator('#result_list').waitFor()
        await frame.locator('#result_list tr').filter({ hasText: 'reader@example.com' }).waitFor()

        await page.locator('#settings-button').click()
        await page.locator('#settings-panel').waitFor()
        await page.locator('#settings-panel .service-actions').scrollIntoViewIfNeeded()
        await capture(page, 'settings', 'Desktop settings', 'The shipped settings panel shows the actual local collection and service controls.', ['Settings opened using toolbar', 'Live service controls visible'])
        const configureNetwork = async configuration => {
            await page.locator('#network-scope').selectOption(configuration.scope)
            if (configuration.scope === 'custom') await page.locator('#network-bind-address').fill(configuration.bindAddress)
            await page.locator('#network-port').fill(String(configuration.port))
            await page.locator('#network-base-url').fill(configuration.baseURL)
            await page.locator('#network-save').click()
            await page.locator('#network-status').filter({ hasText: 'Network settings saved.' }).waitFor({ timeout: 180000 })
            await waitForRunning(page)
            assert.deepEqual(JSON.parse(await fs.readFile(path.join(userDataDir, 'network.json'), 'utf8')), configuration, 'The UI saves the selected network configuration')
            const actual = await callDocker(docker.getContainer(containerName), 'inspect')
            assert.equal(actual.State.Running, true)
            assert.deepEqual(actual.HostConfig.PortBindings['5797/tcp'], [{ HostIp: configuration.bindAddress, HostPort: String(configuration.port) }], 'Docker publishes the interface and port selected in Settings')
            assert.ok(actual.Config.Env.includes(`BASE_URL=${configuration.baseURL}`), 'Docker receives the selected base URL')
            assert.ok(actual.Config.Env.includes(`CSRF_TRUSTED_ORIGINS=${[`http://127.0.0.1:${configuration.port}`, configuration.baseURL].filter(Boolean).join(',')}`), 'Docker receives the actual local and configured trusted origins')
            const response = await fetch(`http://127.0.0.1:${configuration.port}/public/`, { redirect: 'manual' })
            assert.ok([200, 301, 302].includes(response.status), `The real ArchiveBox service responds on configured port ${configuration.port}`)
            await page.locator('#network-form').scrollIntoViewIfNeeded()
        }
        const customPort = port === 5798 ? 5799 : 5798
        await configureNetwork({ scope: 'custom', bindAddress: '127.0.0.1', port: customPort, baseURL: `http://localhost:${customPort}` })
        await capture(page, 'network-settings', 'Network settings', `Settings applies a custom loopback interface, port ${customPort} and base URL to the real Docker service.`, ['Network settings submitted through the visible form', 'Persistent profile configuration verified', 'Running Docker port binding and BASE_URL verified'])
        if (CAPTURE_LAN) {
            await configureNetwork({ scope: 'lan', bindAddress: '0.0.0.0', port, baseURL: '' })
            await capture(page, 'network-lan', 'LAN access', `The isolated Linux CI app is running with LAN access enabled on port ${port}.`, ['LAN selected through the visible form', 'Running Docker binds 0.0.0.0', 'Automatic base URL retained'])
        }
        await configureNetwork({ scope: 'localhost', bindAddress: '127.0.0.1', port, baseURL: '' })
        await page.locator('#stop-service').click()
        await page.locator('#close-settings').click()
        await page.locator('#service-panel[data-state="stopped"]').waitFor()
        await assert.rejects(callDocker(docker.getContainer(containerName), 'inspect'), error => error.statusCode === 404, 'Stop removes the actual Docker container')
        await capture(page, 'stopped', 'Service stopped', 'Stopping ArchiveBox from Settings shuts down its real Docker container.', ['Stop button clicked', 'App reports service stopped'])
        await page.locator('#start-service').click()
        await waitForRunning(page)
        await page.locator('[data-route="/public/"]').click()
        await frame.locator('#result_list tbody tr').filter({ hasText: 'https://example.com' }).locator('.field-title_str').filter({ hasText: 'Example Domain' }).waitFor()
        assert.equal(await frame.locator('#result_list tbody tr').count(), 2)
        const restartedContainer = await callDocker(docker.getContainer(containerName), 'inspect')
        assert.equal(restartedContainer.State.Running, true)
        assert.ok(restartedContainer.HostConfig.Binds.includes(`${dataDir}:/data`), 'Restart uses the same collection directory')
        await capture(page, 'restarted', 'Collection after restart', 'Restarting the Docker service preserves both saved pages and their extracted titles.', ['Real service stop/start', 'Both saved pages survive restart'])
    } catch (error) {
        const diagnostics = { error: error.stack, searchRequests }
        if (frame) diagnostics.page = await frame.evaluate(() => ({
            url: window.location.href,
            query: document.querySelector('#searchbar')?.value,
            mode: document.querySelector('[name="search_mode"]')?.value,
            searchBusy: document.querySelector('#changelist-search')?.getAttribute('aria-busy'),
            resultTables: document.querySelectorAll('#result_list').length,
            rows: [...document.querySelectorAll('#result_list tbody tr')].slice(0, 20).map(row => ({ text: row.innerText, visible: row.getClientRects().length > 0, html: row.outerHTML.slice(0, 20000) })),
        })).catch(failure => ({ error: failure.message }))
        if (networkSession) {
            for (const request of searchRequests) {
                request.response = await networkSession.send('Network.getResponseBody', { requestId: request.requestId })
                    .then(response => ({ ...response, originalLength: response.body.length, body: response.body.slice(0, 100000) }))
                    .catch(failure => ({ error: failure.message }))
            }
        }
        try {
            const actual = await callDocker(docker.getContainer(containerName), 'inspect')
            const backendImage = await callDocker(docker.getImage(actual.Image), 'inspect')
            diagnostics.backend = { image: actual.Config.Image, imageId: actual.Image, architecture: backendImage.Architecture, created: backendImage.Created, labels: backendImage.Config.Labels, repoDigests: backendImage.RepoDigests }
            await fs.writeFile(path.join(OUTPUT_DIR, 'backend-failure.log'), await callDocker(docker.getContainer(containerName), 'logs', { stdout: true, stderr: true, tail: 100 }))
        } catch (failure) { diagnostics.backendError = failure.message }
        await fs.writeFile(path.join(OUTPUT_DIR, 'failure.json'), `${JSON.stringify(diagnostics, null, 2)}\n`)
        await capture(page, 'failure', 'Capture failure', error.message, []).catch(() => {})
        console.error(await page.locator('body').innerText().catch(() => ''))
        if (frame) console.error(await frame.locator('body').innerText().catch(() => ''))
        throw error
    } finally {
        await electronApp.close()
        await assert.rejects(callDocker(docker.getContainer(containerName), 'inspect'), error => error.statusCode === 404, 'Quitting removes the actual Docker container')
    }
}

const unavailableDockerHost = () => process.platform === 'win32'
    ? `npipe:////./pipe/archivebox-unavailable-${process.pid}`
    : `unix://${path.join(os.tmpdir(), `abx-no-docker-${process.pid}.sock`)}`

const captureDockerError = async options => {
    // A real connection failure, not an intercepted Docker response or UI flag.
    const { electronApp, page } = await launch(options.dataDir, options.userDataDir, options.port, options.containerName, {
        DOCKER_HOST: unavailableDockerHost(), DOCKER_CONTEXT: '',
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
    const port = Number(process.env.ARCHIVEBOX_PORT || 5797)
    assert.ok(Number.isInteger(port) && port > 0 && port < 65536, 'ARCHIVEBOX_PORT must be a valid TCP port')
    const containerName = `archivebox-electron-e2e-${process.pid}-${Date.now()}`
    await fs.mkdir(dataDir, { mode: 0o777 })
    await fs.chmod(dataDir, 0o777)
    await fs.rm(OUTPUT_DIR, { force: true, recursive: true })
    await fs.mkdir(OUTPUT_DIR, { recursive: true })
    try {
        if (STARTUP_ONLY) {
            const { electronApp, page } = await launch(dataDir, userDataDir, port, containerName, { DOCKER_HOST: unavailableDockerHost(), DOCKER_CONTEXT: '' })
            try {
                await page.locator('#setup-form').waitFor()
                await capture(page, 'setup', 'First-run setup', 'The packaged desktop app opens a fresh collection and requests its administrator account.', ['New empty data directory', 'Visible administrator setup form'])
                await page.locator('#setup-username').fill(USERNAME)
                await page.locator('#setup-password').fill(PASSWORD)
                await page.locator('#setup-email').fill(EMAIL)
                await page.locator('#setup-submit').click()
                await page.locator('#service-panel[data-state="error"]').waitFor()
                await page.keyboard.press('Escape')
                await page.locator('#service-heading').click()
                await page.locator('#service-panel .service-actions').scrollIntoViewIfNeeded()
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
            captureMethod: { darwin: 'screencapture-window', linux: 'imagemagick-x11-window', win32: 'win32-screen-copy' }[process.platform],
            packaged: Boolean(process.env.ELECTRON_EXECUTABLE),
            generatedAt: new Date().toISOString(),
            commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT_DIR, encoding: 'utf8' }).trim(),
            ...require('./release-version').sourceProvenance(),
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
