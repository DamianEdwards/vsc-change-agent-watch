import * as assert from 'assert';
import {
    RecordingEvent,
    RecordingMetadata,
    RecordingChange,
    RECORDING_FORMAT_VERSION,
    serializeEvent,
    deserializeEvent,
    serializeMetadata,
    deserializeMetadata,
    isMetadataLine,
    rangeToRecordingChange,
    recordingChangeToRange
} from '../../recording';
import * as vscode from 'vscode';

suite('Recording Types Test Suite', () => {
    suite('Event Serialization', () => {
        test('should serialize and deserialize edit event', () => {
            const event: RecordingEvent = {
                timestamp: 1000,
                type: 'edit',
                filePath: 'src/test.ts',
                changes: [
                    { startLine: 10, endLine: 15, text: 'new content' }
                ]
            };

            const serialized = serializeEvent(event);
            const deserialized = deserializeEvent(serialized);

            assert.strictEqual(deserialized.timestamp, event.timestamp);
            assert.strictEqual(deserialized.type, event.type);
            assert.strictEqual(deserialized.filePath, event.filePath);
            assert.strictEqual(deserialized.changes?.length, 1);
            assert.strictEqual(deserialized.changes?.[0].startLine, 10);
            assert.strictEqual(deserialized.changes?.[0].text, 'new content');
        });

        test('should serialize and deserialize create event', () => {
            const event: RecordingEvent = {
                timestamp: 2000,
                type: 'create',
                filePath: 'src/new-file.ts'
            };

            const serialized = serializeEvent(event);
            const deserialized = deserializeEvent(serialized);

            assert.strictEqual(deserialized.timestamp, event.timestamp);
            assert.strictEqual(deserialized.type, 'create');
            assert.strictEqual(deserialized.filePath, event.filePath);
            assert.strictEqual(deserialized.changes, undefined);
        });

        test('should serialize and deserialize delete event', () => {
            const event: RecordingEvent = {
                timestamp: 3000,
                type: 'delete',
                filePath: 'src/deleted.ts'
            };

            const serialized = serializeEvent(event);
            const deserialized = deserializeEvent(serialized);

            assert.strictEqual(deserialized.type, 'delete');
        });
    });

    suite('Metadata Serialization', () => {
        test('should serialize and deserialize metadata', () => {
            const metadata: RecordingMetadata = {
                version: RECORDING_FORMAT_VERSION,
                startTime: '2024-01-15T10:00:00.000Z',
                endTime: '2024-01-15T10:30:00.000Z',
                workspaceName: 'test-workspace',
                eventCount: 100,
                fileCount: 5
            };

            const serialized = serializeMetadata(metadata);
            const deserialized = deserializeMetadata(serialized);

            assert.strictEqual(deserialized.version, RECORDING_FORMAT_VERSION);
            assert.strictEqual(deserialized.startTime, metadata.startTime);
            assert.strictEqual(deserialized.endTime, metadata.endTime);
            assert.strictEqual(deserialized.workspaceName, 'test-workspace');
            assert.strictEqual(deserialized.eventCount, 100);
            assert.strictEqual(deserialized.fileCount, 5);
        });

        test('should identify metadata line', () => {
            const metadata: RecordingMetadata = {
                version: 1,
                startTime: '2024-01-15T10:00:00.000Z'
            };

            const metadataLine = serializeMetadata(metadata);
            const eventLine = serializeEvent({
                timestamp: 1000,
                type: 'edit',
                filePath: 'test.ts'
            });

            assert.strictEqual(isMetadataLine(metadataLine), true);
            assert.strictEqual(isMetadataLine(eventLine), false);
            assert.strictEqual(isMetadataLine('invalid json'), false);
        });
    });

    suite('Range Conversion', () => {
        test('should convert Range to RecordingChange', () => {
            const range = new vscode.Range(5, 0, 10, 0);
            const change = rangeToRecordingChange(range, 'inserted text');

            assert.strictEqual(change.startLine, 5);
            assert.strictEqual(change.endLine, 10);
            assert.strictEqual(change.text, 'inserted text');
        });

        test('should convert RecordingChange to Range', () => {
            const change: RecordingChange = {
                startLine: 20,
                endLine: 25
            };

            const range = recordingChangeToRange(change);

            assert.strictEqual(range.start.line, 20);
            assert.strictEqual(range.end.line, 25);
        });

        test('should handle change without text', () => {
            const range = new vscode.Range(0, 0, 5, 0);
            const change = rangeToRecordingChange(range);

            assert.strictEqual(change.text, undefined);
        });
    });
});
