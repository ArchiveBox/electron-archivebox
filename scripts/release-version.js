const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const releaseVersion = () => {
    const base = JSON.parse(git('show', 'HEAD:package.json')).version
    if (process.env.GITHUB_REF !== 'refs/heads/main') return base
    assert.match(process.env.GITHUB_RUN_NUMBER || '', /^[1-9]\d*$/)
    const [major, minor, patch] = base.split('.').map(Number)
    return `${major}.${minor}.${patch + Number(process.env.GITHUB_RUN_NUMBER)}`
}

// Only the exact, reproducible package-version stamp is excluded from source dirtiness.
// All other tracked edits still invalidate CI screenshot provenance.
function sourceProvenance() {
    const changes = git('diff', 'HEAD', '--name-only').split('\n').filter(Boolean)
    if (!changes.length) return { dirty: false, versionStamp: null }
    if (process.env.GITHUB_REF !== 'refs/heads/main' || !process.env.GITHUB_RUN_NUMBER || changes.length !== 2 || changes.some(file => !['package.json', 'package-lock.json'].includes(file))) return { dirty: true, versionStamp: null }
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
