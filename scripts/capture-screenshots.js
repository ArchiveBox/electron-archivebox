const fs = require('node:fs/promises')
const path = require('node:path')
const { _electron: electron } = require('playwright')

const ROOT_DIR = path.resolve(__dirname, '..')
const OUTPUT_DIR = path.resolve(process.env.SCREENSHOT_DIR || path.join(ROOT_DIR, 'artifacts', 'screenshots'))
const SCREENS = ['archive', 'add-urls', 'manage-users', 'settings']

const captureScreen = async screen => {
    const electronApp = await electron.launch({
        args: [path.join(ROOT_DIR, 'main.js')],
        env: {
            ...process.env,
            ARCHIVEBOX_SCREEN: screen,
            ARCHIVEBOX_SCREENSHOT_MODE: '1',
        },
    })

    try {
        const page = await electronApp.firstWindow()
        await page.waitForSelector('.app-layout')
        await page.screenshot({
            animations: 'disabled',
            path: path.join(OUTPUT_DIR, `${screen}.png`),
        })
        console.log(`Captured ${screen}.png`)
    } finally {
        await electronApp.close()
    }
}

const main = async () => {
    await fs.rm(OUTPUT_DIR, { force: true, recursive: true })
    await fs.mkdir(OUTPUT_DIR, { recursive: true })

    for (const screen of SCREENS) {
        await captureScreen(screen)
    }
}

main().catch(error => {
    console.error(`Screenshot capture failed: ${error.stack || error.message}`)
    process.exitCode = 1
})
