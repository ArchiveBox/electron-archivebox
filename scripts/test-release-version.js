const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')

// Exercise the actual release script against real tags and a clean checkout.
const directory = mkdtempSync(path.join(tmpdir(), 'electron-release-version-'))
const git = (...args) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' })
const source = process.argv[2] || path.join(__dirname, 'release-version.js')
try {
    mkdirSync(path.join(directory, 'scripts'))
    writeFileSync(path.join(directory, 'scripts/release-version.js'), readFileSync(source))
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version: '0.1.0', releaseRunBase: 50 }))
    writeFileSync(path.join(directory, 'package-lock.json'), JSON.stringify({ version: '0.1.0', packages: { '': { version: '0.1.0' } } }))
    git('init', '-b', 'main')
    git('config', 'user.name', 'ArchiveBox version test')
    git('config', 'user.email', 'version-test@example.invalid')
    git('add', '.')
    git('commit', '-m', 'Release source')
    git('tag', 'v0.1.7')
    const run = event => execFileSync(process.execPath, ['scripts/release-version.js'], {
        cwd: directory, encoding: 'utf8',
        env: { ...process.env, GITHUB_EVENT_NAME: event, GITHUB_REF: 'refs/heads/main', GITHUB_RUN_NUMBER: '70', GITHUB_ENV: '' },
    })
    run('schedule')
    assert.equal(JSON.parse(readFileSync(path.join(directory, 'package.json'))).version, '0.1.7', 'Scheduled capture must use the published version, not reserve a new release')
    const provenance = JSON.parse(execFileSync(process.execPath, ['-e', "console.log(JSON.stringify(require('./scripts/release-version').sourceProvenance()))"], {
        cwd: directory, encoding: 'utf8',
        env: { ...process.env, GITHUB_EVENT_NAME: 'schedule', GITHUB_REF: 'refs/heads/main', GITHUB_RUN_NUMBER: '70' },
    }))
    assert.equal(provenance.dirty, false)
    assert.equal(provenance.versionStamp.version, '0.1.7')
    git('restore', 'package.json', 'package-lock.json')
    run('push')
    assert.equal(JSON.parse(readFileSync(path.join(directory, 'package.json'))).version, '0.1.20', 'Normal push release numbering must stay unchanged')
    console.log('Scheduled capture identity and push release numbering verified with real git history.')
} finally {
    rmSync(directory, { recursive: true, force: true })
}
