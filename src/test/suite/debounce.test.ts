import * as assert from 'assert';
import { setTimeout as delay } from 'timers/promises';
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
        }, 50);

        debouncer.call();

        setTimeout(() => {
            debouncer.call();
        }, 150);

        setTimeout(() => {
            assert.strictEqual(callCount, 2);
            done();
        }, 400);
    });

    for (const rejectAsync of [false, true]) {
        test(`Should contain ${rejectAsync ? 'asynchronous' : 'synchronous'} errors and allow later calls`, async () => {
            const expectedError = new Error('Debounced callback failed');
            const unhandledErrors: unknown[] = [];
            const recordUnhandledError = (error: unknown) => {
                unhandledErrors.push(error);
            };
            let callCount = 0;
            const debouncer = debounce(() => {
                callCount++;
                if (callCount === 1) {
                    if (rejectAsync) {
                        return Promise.reject(expectedError);
                    }
                    throw expectedError;
                }
            }, 0);

            process.on('uncaughtException', recordUnhandledError);
            process.on('unhandledRejection', recordUnhandledError);

            try {
                debouncer.call();
                await delay(20);
                assert.strictEqual(callCount, 1);

                debouncer.call();
                await delay(20);
                assert.strictEqual(callCount, 2);
                assert.deepStrictEqual(unhandledErrors, []);
            } finally {
                debouncer.cancel();
                process.removeListener('uncaughtException', recordUnhandledError);
                process.removeListener('unhandledRejection', recordUnhandledError);
            }
        });
    }
});
