import * as assert from 'assert';
import { debounce } from '../../debounce';

suite('Debounce Test Suite', () => {
    test('Should debounce rapid calls', (done) => {
        let callCount = 0;
        const debouncer = debounce(() => {
            callCount++;
        }, 50);

        // Call multiple times rapidly
        debouncer.call();
        debouncer.call();
        debouncer.call();

        // Should not have been called yet
        assert.strictEqual(callCount, 0);

        // Wait for debounce
        setTimeout(() => {
            assert.strictEqual(callCount, 1);
            done();
        }, 100);
    });

    test('Should cancel pending calls', (done) => {
        let callCount = 0;
        const debouncer = debounce(() => {
            callCount++;
        }, 50);

        debouncer.call();
        debouncer.cancel();

        setTimeout(() => {
            assert.strictEqual(callCount, 0);
            done();
        }, 100);
    });

    test('Should allow calls after debounce period', (done) => {
        let callCount = 0;
        const debouncer = debounce(() => {
            callCount++;
        }, 30);

        debouncer.call();

        setTimeout(() => {
            debouncer.call();
        }, 50);

        setTimeout(() => {
            assert.strictEqual(callCount, 2);
            done();
        }, 150);
    });
});
