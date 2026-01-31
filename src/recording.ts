import * as vscode from 'vscode';

/**
 * Types of events that can be recorded
 */
export type RecordingEventType = 'edit' | 'create' | 'delete';

/**
 * Represents a single change within a file
 */
export interface RecordingChange {
    /** Starting line of the change (0-based) */
    startLine: number;
    /** Ending line of the change (0-based) */
    endLine: number;
    /** The text that was inserted/changed (optional for deletes) */
    text?: string;
}

/**
 * Represents a recorded file change event.
 * Each event is stored as a single line in the JSON Lines file.
 */
export interface RecordingEvent {
    /** Timestamp in milliseconds since recording started */
    timestamp: number;
    /** Type of event */
    type: RecordingEventType;
    /** Relative path to the file within the workspace */
    filePath: string;
    /** Changes made to the file (for edit events) */
    changes?: RecordingChange[];
}

/**
 * Metadata stored at the beginning of a recording file (first line)
 */
export interface RecordingMetadata {
    /** Format version for backwards compatibility */
    version: number;
    /** ISO timestamp when recording started */
    startTime: string;
    /** ISO timestamp when recording ended (added when recording stops) */
    endTime?: string;
    /** Workspace folder name */
    workspaceName?: string;
    /** Total number of events (added when recording stops) */
    eventCount?: number;
    /** Number of unique files changed (added when recording stops) */
    fileCount?: number;
}

/**
 * A complete recording loaded into memory
 */
export interface Recording {
    metadata: RecordingMetadata;
    events: RecordingEvent[];
}

/**
 * Current recording format version
 */
export const RECORDING_FORMAT_VERSION = 1;

/**
 * File extension for recording files
 */
export const RECORDING_FILE_EXTENSION = '.fcfr';

/**
 * Serialize a recording event to a JSON line
 */
export function serializeEvent(event: RecordingEvent): string {
    return JSON.stringify(event);
}

/**
 * Deserialize a JSON line to a recording event
 */
export function deserializeEvent(line: string): RecordingEvent {
    return JSON.parse(line) as RecordingEvent;
}

/**
 * Serialize recording metadata to a JSON line
 */
export function serializeMetadata(metadata: RecordingMetadata): string {
    return JSON.stringify({ _metadata: true, ...metadata });
}

/**
 * Check if a line is metadata (first line of file)
 */
export function isMetadataLine(line: string): boolean {
    try {
        const parsed = JSON.parse(line);
        return parsed._metadata === true;
    } catch {
        return false;
    }
}

/**
 * Deserialize a metadata line
 */
export function deserializeMetadata(line: string): RecordingMetadata {
    const parsed = JSON.parse(line);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _metadata, ...metadata } = parsed;
    return metadata as RecordingMetadata;
}

/**
 * Convert a VS Code Range to a RecordingChange
 */
export function rangeToRecordingChange(range: vscode.Range, text?: string): RecordingChange {
    return {
        startLine: range.start.line,
        endLine: range.end.line,
        text
    };
}

/**
 * Convert a RecordingChange back to a VS Code Range
 */
export function recordingChangeToRange(change: RecordingChange): vscode.Range {
    return new vscode.Range(change.startLine, 0, change.endLine, 0);
}
