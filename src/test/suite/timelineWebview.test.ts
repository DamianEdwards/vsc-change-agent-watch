import * as assert from 'assert';
import * as vscode from 'vscode';
import { TimelineWebviewProvider } from '../../timelineWebview';

suite('TimelineWebview Test Suite', () => {
    suite('Provider Registration', () => {
        test('should have correct view type', () => {
            assert.strictEqual(
                TimelineWebviewProvider.viewType,
                'fileChangeFollower.timeline'
            );
        });

        test('should create provider instance', () => {
            // Use a mock URI for testing
            const mockUri = vscode.Uri.file('/test');
            const provider = new TimelineWebviewProvider(mockUri);
            assert.ok(provider);
            provider.dispose();
        });
    });
});
