const nodeGlobals = {
    AbortController: 'readonly',
    Buffer: 'readonly',
    URL: 'readonly',
    __dirname: 'readonly',
    clearTimeout: 'readonly',
    console: 'readonly',
    fetch: 'readonly',
    module: 'readonly',
    process: 'readonly',
    require: 'readonly',
    setTimeout: 'readonly',
}

const browserGlobals = {
    URLSearchParams: 'readonly',
    document: 'readonly',
    window: 'readonly',
}

module.exports = [
    {
        files: ['**/*.js'],
        ignores: ['node_modules/**', 'out/**', 'artifacts/**'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                ...nodeGlobals,
                ...browserGlobals,
            },
        },
        rules: {
            'no-constant-condition': ['error', { checkLoops: false }],
            'no-undef': 'error',
            'no-unreachable': 'error',
        },
    },
]
