import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    Recording,
    RecordingEvent,
    RecordingMetadata,
    deserializeEvent,
    deserializeMetadata,
    isMetadataLine,
    recordingChangeToRange,
    RECORDING_FILE_EXTENSION
} from './recording';
import { ConfigurationManager } from './configuration';

export type PlaybackState = 'stopped' | 'playing' | 'paused';

const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 4];

export interface PlaybackStateChangeEvent {
    state: PlaybackState;
    currentEventIndex: number;
    totalEvents: number;
    speed: number;
}

/**
 * Plays back recorded file change sessions
 */
export class RecordingPlayer implements vscode.Disposable {
    private recording: Recording | undefined;
    private currentEventIndex = 0;
    private _state: PlaybackState = 'stopped';
    private _speed: number;
    private playbackTimer: NodeJS.Timeout | undefined;
    private readonly configManager: ConfigurationManager;
    
    private readonly _onStateChange = new vscode.EventEmitter<PlaybackStateChangeEvent>();
    readonly onStateChange = this._onStateChange.event;

    private readonly _onPlaybackEvent = new vscode.EventEmitter<RecordingEvent>();
    readonly onPlaybackEvent = this._onPlaybackEvent.event;

    constructor(configManager: ConfigurationManager) {
        this.configManager = configManager;
        this._speed = configManager.defaultPlaybackSpeed;
    }

    get state(): PlaybackState {
        return this._state;
    }

    get speed(): number {
        return this._speed;
    }

    get currentIndex(): number {
        return this.currentEventIndex;
    }

    get totalEvents(): number {
        return this.recording?.events.length ?? 0;
    }

    get isLoaded(): boolean {
        return this.recording !== undefined;
    }

    /**
     * Load a recording from a file
     */
    async loadRecording(filePath: string): Promise<boolean> {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n').filter(line => line.trim().length > 0);

            if (lines.length === 0) {
                vscode.window.showErrorMessage('Recording file is empty');
                return false;
            }

            // Parse metadata from first line
            if (!isMetadataLine(lines[0])) {
                vscode.window.showErrorMessage('Invalid recording file: missing metadata');
                return false;
            }

            const metadata: RecordingMetadata = deserializeMetadata(lines[0]);
            const events: RecordingEvent[] = [];

            // Parse remaining lines as events
            for (let i = 1; i < lines.length; i++) {
                try {
                    events.push(deserializeEvent(lines[i]));
                } catch (error) {
                    console.warn(`Failed to parse event at line ${i + 1}:`, error);
                }
            }

            this.recording = { metadata, events };
            this.currentEventIndex = 0;
            this._state = 'stopped';
            this.emitStateChange();

            vscode.window.showInformationMessage(
                `Loaded recording: ${events.length} events`
            );
            return true;
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load recording: ${error}`);
            return false;
        }
    }

    /**
     * Open file picker and load a recording
     */
    async openRecording(): Promise<boolean> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const defaultUri = workspaceFolder 
            ? vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, this.configManager.recordingsPath))
            : undefined;

        const result = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            defaultUri,
            filters: {
                'Recording Files': [RECORDING_FILE_EXTENSION.slice(1)],
                'All Files': ['*']
            },
            title: 'Open Recording File'
        });

        if (result && result.length > 0) {
            return this.loadRecording(result[0].fsPath);
        }
        return false;
    }

    /**
     * Start or resume playback
     */
    play(): void {
        if (!this.recording || this.recording.events.length === 0) {
            vscode.window.showWarningMessage('No recording loaded');
            return;
        }

        if (this._state === 'playing') {
            return;
        }

        if (this.currentEventIndex >= this.recording.events.length) {
            this.currentEventIndex = 0;
        }

        this._state = 'playing';
        this.emitStateChange();
        this.scheduleNextEvent();
    }

    /**
     * Pause playback
     */
    pause(): void {
        if (this._state !== 'playing') {
            return;
        }

        this.clearPlaybackTimer();
        this._state = 'paused';
        this.emitStateChange();
    }

    /**
     * Stop playback and reset position
     */
    stop(): void {
        this.clearPlaybackTimer();
        this._state = 'stopped';
        this.currentEventIndex = 0;
        this.emitStateChange();
    }

    /**
     * Toggle between play and pause
     */
    togglePlayPause(): void {
        if (this._state === 'playing') {
            this.pause();
        } else {
            this.play();
        }
    }

    /**
     * Skip to next event
     */
    skipForward(): void {
        if (!this.recording) {
            return;
        }

        const wasPlaying = this._state === 'playing';
        this.clearPlaybackTimer();

        if (this.currentEventIndex < this.recording.events.length - 1) {
            this.currentEventIndex++;
            this.playCurrentEvent();
        }

        this.emitStateChange();

        if (wasPlaying) {
            this.scheduleNextEventWithoutPlaying();
        }
    }

    /**
     * Skip to previous event
     */
    skipBackward(): void {
        if (!this.recording) {
            return;
        }

        const wasPlaying = this._state === 'playing';
        this.clearPlaybackTimer();

        if (this.currentEventIndex > 0) {
            this.currentEventIndex--;
            this.playCurrentEvent();
        }

        this.emitStateChange();

        if (wasPlaying) {
            this.scheduleNextEventWithoutPlaying();
        }
    }

    /**
     * Seek to a specific event index
     */
    seekTo(index: number): void {
        if (!this.recording) {
            return;
        }

        const wasPlaying = this._state === 'playing';
        this.clearPlaybackTimer();

        this.currentEventIndex = Math.max(0, Math.min(index, this.recording.events.length - 1));
        this.playCurrentEvent();

        this.emitStateChange();

        if (wasPlaying) {
            this.scheduleNextEventWithoutPlaying();
        }
    }

    /**
     * Seek to start
     */
    seekToStart(): void {
        this.seekTo(0);
    }

    /**
     * Seek to end
     */
    seekToEnd(): void {
        if (this.recording) {
            this.seekTo(this.recording.events.length - 1);
        }
    }

    /**
     * Increase playback speed
     */
    speedUp(): void {
        const currentIdx = PLAYBACK_SPEEDS.indexOf(this._speed);
        if (currentIdx < PLAYBACK_SPEEDS.length - 1) {
            this._speed = PLAYBACK_SPEEDS[currentIdx + 1];
            this.emitStateChange();
            
            // Reschedule if playing (without replaying current event)
            if (this._state === 'playing') {
                this.clearPlaybackTimer();
                this.scheduleNextEventWithoutPlaying();
            }
        }
    }

    /**
     * Decrease playback speed
     */
    slowDown(): void {
        const currentIdx = PLAYBACK_SPEEDS.indexOf(this._speed);
        if (currentIdx > 0) {
            this._speed = PLAYBACK_SPEEDS[currentIdx - 1];
            this.emitStateChange();
            
            // Reschedule if playing (without replaying current event)
            if (this._state === 'playing') {
                this.clearPlaybackTimer();
                this.scheduleNextEventWithoutPlaying();
            }
        }
    }

    /**
     * Set playback speed
     */
    setSpeed(speed: number): void {
        if (PLAYBACK_SPEEDS.includes(speed)) {
            this._speed = speed;
            this.emitStateChange();
            
            if (this._state === 'playing') {
                this.clearPlaybackTimer();
                this.scheduleNextEventWithoutPlaying();
            }
        }
    }

    private scheduleNextEvent(): void {
        if (!this.recording || this._state !== 'playing') {
            return;
        }

        if (this.currentEventIndex >= this.recording.events.length) {
            // Playback complete
            this._state = 'stopped';
            this.currentEventIndex = 0;
            this.emitStateChange();
            vscode.window.showInformationMessage('Playback complete');
            return;
        }

        const currentEvent = this.recording.events[this.currentEventIndex];
        const nextEvent = this.recording.events[this.currentEventIndex + 1];

        // Play current event immediately
        this.playCurrentEvent();

        // Schedule next event
        if (nextEvent) {
            const delay = (nextEvent.timestamp - currentEvent.timestamp) / this._speed;
            this.playbackTimer = setTimeout(() => {
                this.currentEventIndex++;
                this.emitStateChange();
                this.scheduleNextEvent();
            }, Math.max(delay, 10)); // Minimum 10ms delay
        } else {
            // Last event - finish playback
            this.playbackTimer = setTimeout(() => {
                this.currentEventIndex++;
                this._state = 'stopped';
                this.currentEventIndex = 0;
                this.emitStateChange();
                vscode.window.showInformationMessage('Playback complete');
            }, 100);
        }
    }

    /**
     * Schedule the next event without playing the current one.
     * Used when speed changes or seeking to avoid replaying the same event.
     */
    private scheduleNextEventWithoutPlaying(): void {
        if (!this.recording || this._state !== 'playing') {
            return;
        }

        if (this.currentEventIndex >= this.recording.events.length - 1) {
            // At last event, nothing more to schedule
            return;
        }

        const currentEvent = this.recording.events[this.currentEventIndex];
        const nextEvent = this.recording.events[this.currentEventIndex + 1];

        if (nextEvent) {
            const delay = (nextEvent.timestamp - currentEvent.timestamp) / this._speed;
            this.playbackTimer = setTimeout(() => {
                this.currentEventIndex++;
                this.emitStateChange();
                this.scheduleNextEvent();
            }, Math.max(delay, 10));
        }
    }

    private async playCurrentEvent(): Promise<void> {
        if (!this.recording || this.currentEventIndex >= this.recording.events.length) {
            return;
        }

        const event = this.recording.events[this.currentEventIndex];
        this._onPlaybackEvent.fire(event);

        // Open file and show changes
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        const filePath = path.join(workspaceFolder.uri.fsPath, event.filePath);
        
        try {
            if (event.type === 'delete') {
                // Can't show deleted files
                return;
            }

            const uri = vscode.Uri.file(filePath);
            
            // Check if file exists
            try {
                await vscode.workspace.fs.stat(uri);
            } catch {
                // File doesn't exist
                return;
            }

            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document, {
                preview: false,
                preserveFocus: true
            });

            // Reveal the changed range
            if (event.changes && event.changes.length > 0) {
                const lastChange = event.changes[event.changes.length - 1];
                const range = recordingChangeToRange(lastChange);
                editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            }
        } catch (error) {
            console.log(`Playback: Could not open ${filePath}:`, error);
        }
    }

    private clearPlaybackTimer(): void {
        if (this.playbackTimer) {
            clearTimeout(this.playbackTimer);
            this.playbackTimer = undefined;
        }
    }

    private emitStateChange(): void {
        this._onStateChange.fire({
            state: this._state,
            currentEventIndex: this.currentEventIndex,
            totalEvents: this.recording?.events.length ?? 0,
            speed: this._speed
        });
    }

    dispose(): void {
        this.clearPlaybackTimer();
        this._onStateChange.dispose();
        this._onPlaybackEvent.dispose();
    }
}
