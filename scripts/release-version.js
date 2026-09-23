const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const releaseVersion = () => {
    const { version: base, releaseRunBase = 0 } = JSON.parse(git('show', 'HEAD:package.json'))
    if (process.env.GITHUB_REF !== 'refs/heads/main') return base
    if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
        const tags = git('tag', '--merged', 'HEAD', '--list', 'v*').split('\n').filter(tag => /^v\d+\.\d+\.\d+$/.test(tag))
        const tag = tags.sort((a, b) => b.slice(1).localeCompare(a.slice(1), undefined, { numeric: true }))[0]
        assert.ok(tag, 'Server compatibility captures require an existing desktop app release')
        const marketingFile = file => file === 'README.md' || file === '.github/workflows/pages.yml' || file.startsWith('docs/') || file.startsWith('.github/pages/')
        assert.ok(git('diff', '--name-only', tag, 'HEAD').split('\n').filter(Boolean).every(marketingFile), 'Unreleased desktop app changes require the normal push release before server compatibility capture')
        return tag.slice(1)
    }
    assert.match(process.env.GITHUB_RUN_NUMBER || '', /^[1-9]\d*$/)
    // Start this version series at its base instead of adding all prior CI runs.
    const increment = Number(process.env.GITHUB_RUN_NUMBER) - releaseRunBase
    assert.ok(Number.isSafeInteger(releaseRunBase) && increment >= 0, 'CI run predates this release series')
    const [major, minor, patch] = base.split('.').map(Number)
    return `${major}.${minor}.${patch + increment}`
}

// Only the exact, reproducible package-version stamp is excluded from source dirtiness.
// All other tracked edits still invalidate CI screenshot provenance.
function sourceProvenance() {
    const changes = git('diff', 'HEAD', '--name-only').split('\n').filter(Boolean)
    if (!changes.length) return { dirty: false, versionStamp: null }
    if (process.env.GITHUB_REF !== 'refs/heads/main' || changes.length !== 2 || changes.some(file => !['package.json', 'package-lock.json'].includes(file))) return { dirty: true, versionStamp: null }
    const version = releaseVersion()
    for (const file of changes) {
        const original = JSON.parse(git('show', `HEAD:${file}`))
        original.version = version
        if (file === 'package-lock.json') original.packages[''].version = version
        try { assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')), original) }
        catch { return { dirty: true, versionStamp: null } }
    }
    return { dirty: false, versionStamp: { version, runNumber: Number(process.env.GITHUB_RUN_NUMBER), files: changes } }
}

if (require.main === module) {
    assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'Version stamping requires a clean checkout')
    const version = releaseVersion()
    for (const file of ['package.json', 'package-lock.json']) {
        const filename = path.join(root, file)
        const value = JSON.parse(fs.readFileSync(filename, 'utf8'))
        if (value.version === version) continue
        value.version = version
        if (file === 'package-lock.json') value.packages[''].version = version
        fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`)
    }
    if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, `RELEASE_VERSION=${version}\n`)
    console.log(`App version: ${version}`)
}

module.exports = { sourceProvenance, releaseVersion }
