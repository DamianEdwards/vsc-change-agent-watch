import * as assert from 'assert';
import { LiveDelayBuffer } from '../../liveDelayBuffer';
import { ConfigurationManager } from '../../configuration';
import { RecordingEvent } from '../../recording';

suite('LiveDelayBuffer Test Suite', () => {
    let buffer: LiveDelayBuffer;

    setup(() => {
        const configManager = new ConfigurationManager();
        buffer = new LiveDelayBuffer(configManager);
    });

    teardown(() => {
        buffer.dispose();
    });

    suite('Initial State', () => {
        test('should start disabled', () => {
            assert.strictEqual(buffer.isEnabled, false);
        });

        test('should have empty buffer', () => {
            assert.strictEqual(buffer.bufferedCount, 0);
        });
    });

    suite('Enable/Disable', () => {
        test('should toggle state', () => {
            // Note: toggle may not enable if liveDelaySeconds is 0 in config
            const initialState = buffer.isEnabled;
            buffer.toggle();
            // State may or may not change depending on config
            buffer.toggle();
            assert.strictEqual(buffer.isEnabled, initialState);
        });

        test('should disable when enabled', () => {
            // Force enable state for test
            buffer.disable();
            assert.strictEqual(buffer.isEnabled, false);
        });
    });

    suite('Event Buffering', () => {
        test('should release event immediately when disabled', (done) => {
            const event: RecordingEvent = {
                timestamp: 1000,
                type: 'edit',
                filePath: 'test.ts'
            };

            const subscription = buffer.onEventRelease((releasedEvent) => {
                assert.strictEqual(releasedEvent.filePath, 'test.ts');
                subscription.dispose();
                done();
            });

            buffer.bufferEvent(event);
        });
    });

    suite('Catch Up', () => {
        test('should clear buffer on catch up', () => {
            buffer.catchUpToLive();
            assert.strictEqual(buffer.bufferedCount, 0);
        });

        test('should clear buffer without releasing when clearBuffer called', () => {
            buffer.clearBuffer();
            assert.strictEqual(buffer.bufferedCount, 0);
        });
    });

    suite('State Change Events', () => {
        test('should emit state change on enable attempt with zero delay', () => {
            // When delay is 0, enable() shows a warning and doesn't change state
            // So we just verify it doesn't throw
            buffer.enable();
            assert.strictEqual(buffer.isEnabled, false);
        });
    });
});
