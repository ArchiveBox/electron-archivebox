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
    const sha = process.env.GITHUB_SHA
    const previous = JSON.parse(execFileSync('gh', ['api', `repos/${repo}/releases?per_page=100`], { encoding: 'utf8' }))
        .filter(release => !release.draft && !release.prerelease && /^v\d+\.\d+\.\d+$/.test(release.tag_name) && release.tag_name !== tag)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.tag_name
    const generated = JSON.parse(execFileSync('gh', ['api', `repos/${repo}/releases/generate-notes`, '-f', `tag_name=${tag}`, '-f', `target_commitish=${sha}`, ...(previous ? ['-f', `previous_tag_name=${previous}`] : [])], { encoding: 'utf8' })).body
    const contributorBlock = generated.match(/^## (?:New )?Contributors\n[\s\S]*?(?=^## |\*\*Full Changelog|$(?![\s\S]))/m)?.[0] || ''
    const contributorLines = contributorBlock.split('\n').filter(line => !/@pirate\b|Nick Sweeting/i.test(line))
    const contributors = contributorLines.slice(1).some(line => line.trim()) ? contributorLines.join('\n').trim() : ''
    const from = previous
    const changelog = from ? `[\`${from}...${tag}\`](https://github.com/${repo}/compare/${from}...${tag})` : `[\`${tag}\`](https://github.com/${repo}/commits/${tag})`
    const commits = execFileSync('git', ['log', '--reverse', '--format=%H%x09%s', ...(from ? [`${from}..${sha}`] : [sha])], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
        .map(line => { const [commit, subject] = line.split('\t'); return `- [${commit.slice(0, 7)}](https://github.com/${repo}/commit/${commit}) ${subject}` }).join('\n')
    let notes = `## Install\n\n- 🪟 **Windows:** Download \`ArchiveBox-Windows.exe\` from the Assets section below and run the installer. Install and start Docker Desktop with Linux containers enabled.\n- 🐧 **Debian / Ubuntu:** Download \`ArchiveBox-Linux.deb\` and install it. **Fedora / RHEL:** Download \`ArchiveBox-Linux.rpm\` and install it. Keep Docker Engine running.\n- 🍏 **macOS:** Download \`ArchiveBox-Mac.dmg\`, open it, and drag ArchiveBox to \`/Applications\`. The disk image supports Intel and Apple Silicon Macs. Install and start Docker Desktop before opening ArchiveBox. You may need to \`Right Click > Open\` to launch it the first time.\n\nIf you run into a problem, please [🐛 report it here](https://github.com/${repo}/issues).\n\n[💻 Screenshots](https://electron.archivebox.io/screenshots/) · [📖 Documentation](https://docs.archivebox.io) · [💬 \`@ArchiveBoxApp\`](https://x.com/ArchiveBoxApp)\n\n**Full Changelog:** ${changelog}\n\n## All changes\n\n${commits}\n\nSource: [\`${sha.slice(0, 7)}\`](https://github.com/${repo}/commit/${sha})${contributors ? `\n\n${contributors}` : ''}\n`
    notes = notes.replace(`If you run into a problem, please [🐛 report it here](https://github.com/${repo}/issues).\n\n`, '')
    notes = notes.replace(`[💻 Screenshots](https://electron.archivebox.io/screenshots/) · [📖 Documentation](https://docs.archivebox.io) · [💬 \`@ArchiveBoxApp\`](https://x.com/ArchiveBoxApp)`, `[💻 Screenshots](https://electron.archivebox.io/screenshots/) · [📖 Documentation](https://docs.archivebox.io/) · [💬 \`@ArchiveBoxApp\`](https://x.com/ArchiveBoxApp) · [🐞 Report a bug](https://github.com/${repo}/issues?q=sort%3Aupdated-desc+is%3Aissue+state%3Aopen)`)
    const notesFile = path.join(directory, 'release-notes.md')
    await fs.writeFile(notesFile, notes)
    const gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    let existing
    // The tag REST endpoint cannot find a draft whose tag is not published yet.
    // gh release view resolves both drafts and published releases.
    try { existing = JSON.parse(gh(['release', 'view', tag, '--repo', repo, '--json', 'apiUrl,body'])) }
    catch (error) {
        if (error.stderr?.toString().trim() !== 'release not found') throw error
    }
    if (existing) {
        assert.ok(existing.body.includes(`Source: ${process.env.GITHUB_SHA}`), 'Existing release belongs to a different source revision')
    } else {
        gh(['release', 'create', tag, '--repo', repo, '--target', sha, '--title', tag, '--notes-file', notesFile, '--draft'])
    }
    gh(['release', 'upload', tag, ...assets.concat('SHA256SUMS').map(file => path.join(directory, file)), '--repo', repo, '--clobber'])
    const release = JSON.parse(gh(['release', 'view', tag, '--repo', repo, '--json', 'apiUrl']))
    // GitHub resolves latest by date and semantic version, even when builds finish out of order.
    gh(['api', '--method', 'PATCH', release.apiUrl, '-F', 'draft=false', '-F', 'prerelease=false', '-f', 'make_latest=legacy'])
    gh(['release', 'edit', tag, '--repo', repo, '--title', tag, '--notes-file', notesFile])
    console.log(`Published https://github.com/${repo}/releases/tag/${tag}`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
