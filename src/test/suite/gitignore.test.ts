import * as assert from 'assert';
import ignore from 'ignore';

suite('Gitignore Integration Test Suite', () => {
    test('ignore package should be loadable', () => {
        // This test verifies that the 'ignore' package is properly bundled
        // and can be loaded at runtime. This prevents regression of issue #7
        // where the package was missing from the VSIX.
        assert.ok(typeof ignore === 'function', 'ignore should be a function');
    });

    test('ignore package should create functional instance', () => {
        const ig = ignore();
        assert.ok(ig, 'ignore() should return an instance');
        assert.ok(typeof ig.add === 'function', 'instance should have add method');
        assert.ok(typeof ig.ignores === 'function', 'instance should have ignores method');
    });

    test('ignore package should correctly filter paths', () => {
        const ig = ignore().add(['node_modules/', '*.log', 'dist/']);

        // Should ignore these paths
        assert.strictEqual(ig.ignores('node_modules/package/index.js'), true);
        assert.strictEqual(ig.ignores('error.log'), true);
        assert.strictEqual(ig.ignores('dist/bundle.js'), true);

        // Should not ignore these paths
        assert.strictEqual(ig.ignores('src/index.ts'), false);
        assert.strictEqual(ig.ignores('package.json'), false);
    });

    test('ignore package should handle negation patterns', () => {
        const ig = ignore().add(['*.log', '!important.log']);

        assert.strictEqual(ig.ignores('debug.log'), true);
        assert.strictEqual(ig.ignores('important.log'), false);
    });
});
