const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const repo = 'https://github.com/ArchiveBox/electron-archivebox'
const canonical = 'https://electron.archivebox.io/'
const option = (name, fallback) => {
    const index = process.argv.indexOf(name)
    return index < 0 ? fallback : process.argv[index + 1]
}
const base = `/${option('--baseurl', '').replace(/^\/+|\/+$/g, '')}/`.replace('//', '/')
const input = path.resolve(root, option('--screenshots-dir', 'artifacts/screenshots'))
const output = path.resolve(root, option('--output', '_site'))
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))

async function main() {
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    const manifests = []
    for (const platform of ['linux', 'windows', 'macos']) {
        let captureManifest
        try {
            captureManifest = JSON.parse(await fs.readFile(path.join(input, platform, 'manifest.json'), 'utf8'))
        } catch (error) {
            if (error.code !== 'ENOENT' || !process.argv.includes('--allow-missing-screenshots')) throw error
            continue
        }
        if (captureManifest.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(captureManifest.commit) || !captureManifest.appVersion || !Number.isFinite(Date.parse(captureManifest.generatedAt)) || !captureManifest.screenshots?.length || !captureManifest.requiredScreenshots?.length) throw new Error('Incomplete capture provenance or coverage contract')
        if (process.env.GITHUB_SHA) {
            const expectedScope = platform === 'linux' ? 'full' : 'startup-only'
            const expectedPlatform = { linux: /^linux-/, windows: /^win32-/, macos: /^darwin-/ }[platform]
            if (captureManifest.commit !== process.env.GITHUB_SHA || captureManifest.dirty !== false || captureManifest.packaged !== true || captureManifest.captureScope !== expectedScope || !expectedPlatform.test(captureManifest.platform)) throw new Error(`Capture provenance does not match this CI build: ${platform}`)
            if (captureManifest.appVersion !== require('./release-version').releaseVersion()) throw new Error(`Capture app version does not match this release: ${platform}`)
        }
        if (captureManifest.captureScope === 'full' && (!captureManifest.dockerImage?.reference || !/^sha256:[a-f0-9]{64}$/.test(captureManifest.dockerImage?.id))) throw new Error(`Missing Docker image provenance: ${platform}`)
        if (process.env.GITHUB_RUN_ID && (String(captureManifest.workflowRun?.id) !== process.env.GITHUB_RUN_ID || captureManifest.workflowRun?.url !== `${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`)) throw new Error(`Capture belongs to a different CI run: ${platform}`)
        const ids = new Set()
        for (const capture of captureManifest.screenshots) {
            if (!/^[a-z0-9-]+$/.test(capture.id) || ids.has(capture.id) || !capture.title || !/^[a-zA-Z0-9_-]+\.png$/.test(capture.file)) throw new Error('Invalid screenshot entry')
            ids.add(capture.id)
            const image = await fs.readFile(path.join(input, platform, capture.file))
            if (image.length < 24 || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || image.readUInt32BE(16) !== capture.width || image.readUInt32BE(20) !== capture.height || capture.width < 1 || capture.height < 1 || createHash('sha256').update(image).digest('hex') !== capture.sha256) throw new Error(`Screenshot dimensions or digest mismatch: ${platform}/${capture.file}`)
        }
        for (const id of captureManifest.requiredScreenshots) if (!ids.has(id)) throw new Error(`Missing required screenshot: ${platform}/${id}`)
        manifests.push({ ...captureManifest, artifactPlatform: platform })
    }
    const screenshots = manifests.flatMap(manifest => manifest.screenshots.map(capture => ({ ...capture, id: `${manifest.artifactPlatform}-${capture.id}`, file: `${manifest.artifactPlatform}/${capture.file}`, commit: manifest.commit, platform: manifest.platform })))
    const [header, footer, landing] = await Promise.all(['header.html', 'footer.html', 'index.html'].map(file => fs.readFile(path.join(root, 'docs', file), 'utf8')))
    const description = 'ArchiveBox Desktop: an Electron app for saving and browsing your web archive on Windows, Linux, and Mac. Powered by a local ArchiveBox Docker server.'
    const page = (title, content, gallery = false) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#9b2854"><title>${escape(title)}</title><meta name="description" content="${description}"><link rel="canonical" href="${canonical}${gallery ? 'screenshots/' : ''}"><meta name="robots" content="index,follow,max-image-preview:large"><meta property="og:type" content="website"><meta property="og:site_name" content="ArchiveBox"><meta property="og:locale" content="en_US"><meta property="og:url" content="${canonical}${gallery ? 'screenshots/' : ''}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${description}"><meta property="og:image" content="${canonical}assets/social-card.png"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="ArchiveBox — preserve the web"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${description}"><meta name="twitter:image" content="${canonical}assets/social-card.png"><link rel="icon" href="${base}assets/favicon.ico"><link rel="apple-touch-icon" href="${base}assets/apple-touch-icon.png"><link rel="stylesheet" href="${base}style.css?v=${revision}"><link rel="stylesheet" href="${base}site-chrome.css?v=${revision}"></head><body><a class="skip-link" href="#content">Skip to content</a>${header}<main id="content">${content}</main>${footer}</body></html>`.replaceAll('__BASE__', base)
    const figure = capture => `<figure><a href="${base}screenshots/${escape(capture.file)}?v=${capture.commit}"><img src="${base}screenshots/${escape(capture.file)}?v=${capture.commit}" alt="${escape(capture.title)} — real Electron application" width="${capture.width}" height="${capture.height}" loading="lazy"></a><figcaption>${capture.width} × ${capture.height} · <a href="${base}screenshots/${escape(capture.file)}">Full image</a></figcaption></figure>`
    let gallery = '<h1>Screenshots</h1><p>Real app screens captured by driving the ordinary Electron application. Capture scope and backend details are recorded separately for each platform.</p>'
    if (manifests.length) {
        gallery += '<p>Full captures cover the complete Docker-backed workflow. Startup-only captures cover application setup and the genuine Docker-unavailable state; they do not claim Docker-backed coverage. Each set identifies its actual operating system below.</p>'
        for (const manifest of manifests) {
            const runURL = manifest.workflowRun?.url
            if (runURL && !/^https:\/\/github\.com\/ArchiveBox\/electron-archivebox\/actions\/runs\/\d+$/.test(runURL)) throw new Error('Unexpected workflow run URL')
            gallery += `<p class="provenance">${escape(manifest.platform)} · ${escape(manifest.captureScope)} · ${manifest.packaged ? 'Packaged app' : 'Source checkout'}${manifest.dirty ? ' · Uncommitted changes' : ''} · App ${escape(manifest.appVersion)} · <a href="${repo}/commit/${manifest.commit}">${manifest.commit.slice(0, 12)}</a> · <time datetime="${escape(manifest.generatedAt)}">${escape(manifest.generatedAt)}</time>${runURL ? ` · <a href="${runURL}">Capture run ↗</a>` : ' · Local capture'} · <a href="${manifest.artifactPlatform}/manifest.json">Capture manifest</a></p>`
            if (manifest.dockerImage) gallery += `<p class="provenance">Backend: <code>${escape(manifest.dockerImage.reference)}</code> · Image <code>${escape(manifest.dockerImage.id)}</code></p>`
        }
        gallery += `<ul class="capture-index">${screenshots.map(capture => `<li><a href="#${capture.id}">${escape(capture.platform)} · ${escape(capture.title)}</a></li>`).join('')}</ul>`
        gallery += screenshots.map(capture => `<article class="capture" id="${capture.id}"><h2>${escape(capture.title)} <small>· ${escape(capture.platform)}</small></h2><p>${escape(capture.description || '')}</p>${capture.route ? `<p class="capture-meta"><code>${escape(capture.route)}</code></p>` : ''}${figure(capture)}</article>`).join('')
    } else {
        gallery += `<p class="empty">The first complete automated capture has not been published yet. <a href="${repo}/actions/workflows/ci.yml">View CI progress</a>.</p>`
    }
    await fs.rm(output, { recursive: true, force: true })
    await fs.mkdir(path.join(output, 'screenshots'), { recursive: true })
    for (const file of ['assets', 'style.css', 'site-chrome.css']) await fs.cp(path.join(root, 'docs', file), path.join(output, file), { recursive: true })
    for (const manifest of manifests) {
        await fs.mkdir(path.join(output, 'screenshots', manifest.artifactPlatform), { recursive: true })
        await fs.copyFile(path.join(input, manifest.artifactPlatform, 'manifest.json'), path.join(output, 'screenshots', manifest.artifactPlatform, 'manifest.json'))
    }
    for (const capture of screenshots) await fs.copyFile(path.join(input, capture.file), path.join(output, 'screenshots', capture.file))
    const hero = screenshots.find(capture => capture.id === 'linux-archive') || screenshots[0]
    await fs.writeFile(path.join(output, 'index.html'), page('ArchiveBox Desktop · Windows, Linux & Mac', landing.replace('__HERO_SCREENSHOT__', hero ? figure(hero) : '')))
    await fs.writeFile(path.join(output, 'screenshots/index.html'), page('Screenshots · ArchiveBox Desktop', gallery, true))
    await fs.writeFile(path.join(output, '.nojekyll'), '')
    await fs.writeFile(path.join(output, 'CNAME'), new URL(canonical).hostname + '\n')
    await fs.writeFile(path.join(output, 'build.json'), JSON.stringify({ revision, generatedAt: new Date().toISOString(), captures: manifests.map(({ platform, commit }) => ({ platform, commit })), screenshots: screenshots.length }, null, 2) + '\n')
    console.log(`Built ${output}: ${screenshots.length} real screenshots`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
