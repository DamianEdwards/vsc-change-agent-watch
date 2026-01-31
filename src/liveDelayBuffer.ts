import * as vscode from 'vscode';
import { RecordingEvent } from './recording';
import { ConfigurationManager } from './configuration';

interface BufferedEvent {
    event: RecordingEvent;
    releaseTime: number;
}

/**
 * Buffers live file change events and releases them after a configurable delay.
 * This creates a "live delay" experience similar to watching a live stream.
 */
export class LiveDelayBuffer implements vscode.Disposable {
    private _isEnabled = false;
    private buffer: BufferedEvent[] = [];
    private releaseTimer: NodeJS.Timeout | undefined;
    private readonly configManager: ConfigurationManager;

    private readonly _onEventRelease = new vscode.EventEmitter<RecordingEvent>();
    readonly onEventRelease = this._onEventRelease.event;

    private readonly _onDelayStateChange = new vscode.EventEmitter<{ enabled: boolean; delaySeconds: number }>();
    readonly onDelayStateChange = this._onDelayStateChange.event;

    constructor(configManager: ConfigurationManager) {
        this.configManager = configManager;
    }

    get isEnabled(): boolean {
        return this._isEnabled;
    }

    get delaySeconds(): number {
        return this.configManager.liveDelaySeconds;
    }

    get bufferedCount(): number {
        return this.buffer.length;
    }

    /**
     * Enable live delay mode
     */
    enable(): void {
        if (this._isEnabled) {
            return;
        }

        if (this.configManager.liveDelaySeconds <= 0) {
            vscode.window.showWarningMessage(
                'Live delay is disabled. Set fileChangeFollower.liveDelaySeconds to enable.'
            );
            return;
        }

        this._isEnabled = true;
        this.startReleaseTimer();
        this._onDelayStateChange.fire({ 
            enabled: true, 
            delaySeconds: this.configManager.liveDelaySeconds 
        });
        vscode.window.showInformationMessage(
            `Live delay enabled: ${this.configManager.liveDelaySeconds}s delay`
        );
    }

    /**
     * Disable live delay mode
     */
    disable(): void {
        if (!this._isEnabled) {
            return;
        }

        this._isEnabled = false;
        this.stopReleaseTimer();
        this._onDelayStateChange.fire({ enabled: false, delaySeconds: 0 });
        vscode.window.showInformationMessage('Live delay disabled');
    }

    /**
     * Toggle live delay mode
     */
    toggle(): void {
        if (this._isEnabled) {
            this.disable();
        } else {
            this.enable();
        }
    }

    /**
     * Buffer an incoming event for delayed release
     */
    bufferEvent(event: RecordingEvent): void {
        if (!this._isEnabled) {
            // If not enabled, release immediately
            this._onEventRelease.fire(event);
            return;
        }

        const releaseTime = Date.now() + (this.configManager.liveDelaySeconds * 1000);
        this.buffer.push({ event, releaseTime });
    }

    /**
     * Catch up to live - release all buffered events immediately
     */
    catchUpToLive(): void {
        for (const buffered of this.buffer) {
            this._onEventRelease.fire(buffered.event);
        }
        this.buffer = [];
        vscode.window.showInformationMessage('Caught up to live');
    }

    /**
     * Clear all buffered events without releasing them
     */
    clearBuffer(): void {
        this.buffer = [];
    }

    private startReleaseTimer(): void {
        this.stopReleaseTimer();
        
        // Check for events to release every 100ms
        this.releaseTimer = setInterval(() => {
            this.releaseReadyEvents();
        }, 100);
    }

    private stopReleaseTimer(): void {
        if (this.releaseTimer) {
            clearInterval(this.releaseTimer);
            this.releaseTimer = undefined;
        }
    }

    private releaseReadyEvents(): void {
        const now = Date.now();
        const readyEvents: BufferedEvent[] = [];
        const remainingEvents: BufferedEvent[] = [];

        for (const buffered of this.buffer) {
            if (buffered.releaseTime <= now) {
                readyEvents.push(buffered);
            } else {
                remainingEvents.push(buffered);
            }
        }

        this.buffer = remainingEvents;

        // Release events in order
        for (const buffered of readyEvents) {
            this._onEventRelease.fire(buffered.event);
        }
    }

    dispose(): void {
        this.stopReleaseTimer();
        this._onEventRelease.dispose();
        this._onDelayStateChange.dispose();
    }
}
