const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { releaseVersion } = require('./release-version')

async function main() {
    assert.equal(process.env.GITHUB_REF, 'refs/heads/main')
    const version = releaseVersion()
    const tag = `v${version}`
    const repo = process.env.GITHUB_REPOSITORY
    assert.equal(repo, 'ArchiveBox/electron-archivebox')
    const directory = path.resolve('artifacts/releases')
    const assets = ['ArchiveBox-Windows.exe', 'ArchiveBox-Linux.deb', 'ArchiveBox-Linux.rpm', 'ArchiveBox-Mac.dmg']
    const checksums = []
    for (const file of assets) {
        const bytes = await fs.readFile(path.join(directory, file))
        assert.ok(bytes.length > 1000000, `Installer is unexpectedly small: ${file}`)
        checksums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${file}`)
    }
    await fs.writeFile(path.join(directory, 'SHA256SUMS'), `${checksums.join('\n')}\n`)
    const notes = `ArchiveBox Desktop ${version}\n\nDownload the installer for your platform below. Docker must be installed and running (Linux containers on Windows). The Mac DMG includes Intel and Apple Silicon support.\n\nThese installers are not code-signed. Your operating system may require approval on first launch.\n\n[Setup guide](https://electron.archivebox.io/) · [Real app screenshots](https://electron.archivebox.io/screenshots/) · [Build and verification](https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID})\n\nSource: ${process.env.GITHUB_SHA}\n`
    const notesFile = path.join(directory, 'release-notes.md')
    await fs.writeFile(notesFile, notes)
    const gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
    const releases = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`])).flat()
    const existing = releases.find(release => release.tag_name === tag)
    if (existing) {
        assert.ok(existing.body.includes(`Source: ${process.env.GITHUB_SHA}`), 'Existing release belongs to a different source revision')
    } else {
        gh(['release', 'create', tag, '--repo', repo, '--target', process.env.GITHUB_SHA, '--title', `ArchiveBox Desktop ${version}`, '--notes-file', notesFile, '--draft'])
    }
    gh(['release', 'upload', tag, ...assets.concat('SHA256SUMS').map(file => path.join(directory, file)), '--repo', repo, '--clobber'])
    const release = JSON.parse(gh(['api', `repos/${repo}/releases/tags/${tag}`]))
    // GitHub resolves latest by date and semantic version, even when builds finish out of order.
    gh(['api', '--method', 'PATCH', `repos/${repo}/releases/${release.id}`, '-F', 'draft=false', '-f', 'make_latest=legacy'])
    console.log(`Published https://github.com/${repo}/releases/tag/${tag}`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
