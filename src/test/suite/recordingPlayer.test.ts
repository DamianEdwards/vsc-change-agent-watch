import * as assert from 'assert';
import { RecordingPlayer } from '../../recordingPlayer';
import { ConfigurationManager } from '../../configuration';

suite('RecordingPlayer Test Suite', () => {
    let player: RecordingPlayer;

    setup(() => {
        const configManager = new ConfigurationManager();
        player = new RecordingPlayer(configManager);
    });

    teardown(() => {
        player.dispose();
    });

    suite('Initial State', () => {
        test('should start in stopped state', () => {
            assert.strictEqual(player.state, 'stopped');
        });

        test('should have no recording loaded', () => {
            assert.strictEqual(player.isLoaded, false);
            assert.strictEqual(player.totalEvents, 0);
        });

        test('should have default speed', () => {
            assert.strictEqual(player.speed, 1);
        });
    });

    suite('State Transitions', () => {
        test('should not play without recording', () => {
            player.play();
            // Should remain stopped since no recording is loaded
            assert.strictEqual(player.state, 'stopped');
        });

        test('should toggle play/pause', () => {
            // Without a recording, toggle should not change state
            player.togglePlayPause();
            assert.strictEqual(player.state, 'stopped');
        });

        test('should stop and reset', () => {
            player.stop();
            assert.strictEqual(player.state, 'stopped');
            assert.strictEqual(player.currentIndex, 0);
        });
    });

    suite('Speed Controls', () => {
        test('should speed up', () => {
            assert.strictEqual(player.speed, 1);
            player.speedUp();
            assert.strictEqual(player.speed, 2);
            player.speedUp();
            assert.strictEqual(player.speed, 4);
        });

        test('should not exceed max speed', () => {
            player.setSpeed(4);
            player.speedUp();
            assert.strictEqual(player.speed, 4);
        });

        test('should slow down', () => {
            player.setSpeed(2);
            player.slowDown();
            assert.strictEqual(player.speed, 1);
            player.slowDown();
            assert.strictEqual(player.speed, 0.5);
        });

        test('should not go below min speed', () => {
            player.setSpeed(0.25);
            player.slowDown();
            assert.strictEqual(player.speed, 0.25);
        });

        test('should set valid speed', () => {
            player.setSpeed(2);
            assert.strictEqual(player.speed, 2);
        });

        test('should ignore invalid speed', () => {
            player.setSpeed(3); // Not a valid speed
            assert.strictEqual(player.speed, 1); // Default
        });
    });

    suite('Event Emitter', () => {
        test('should emit state change events', (done) => {
            const subscription = player.onStateChange((event) => {
                assert.strictEqual(event.state, 'stopped');
                subscription.dispose();
                done();
            });

            // Trigger a state change
            player.stop();
        });
    });

    suite('Seek Controls', () => {
        test('should handle seek without recording', () => {
            player.seekTo(5);
            // Should not throw
            assert.strictEqual(player.currentIndex, 0);
        });

        test('should handle skip forward without recording', () => {
            player.skipForward();
            assert.strictEqual(player.currentIndex, 0);
        });

        test('should handle skip backward without recording', () => {
            player.skipBackward();
            assert.strictEqual(player.currentIndex, 0);
        });

        test('should handle seek to start/end without recording', () => {
            player.seekToStart();
            assert.strictEqual(player.currentIndex, 0);
            player.seekToEnd();
            // With no recording, should stay at 0
        });
    });
});
