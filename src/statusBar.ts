import * as vscode from 'vscode';

export type StatusBarMode = 'idle' | 'following' | 'recording' | 'playing' | 'paused';

export interface PlaybackStatus {
    currentEvent: number;
    totalEvents: number;
    speed: number;
}

export class StatusBarManager implements vscode.Disposable {
    private readonly statusBarItem: vscode.StatusBarItem;
    private currentMode: StatusBarMode = 'idle';
    private playbackStatus: PlaybackStatus | undefined;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.update('idle');
        this.statusBarItem.show();
    }

    update(mode: StatusBarMode, playbackStatus?: PlaybackStatus): void {
        this.currentMode = mode;
        this.playbackStatus = playbackStatus;

        switch (mode) {
            case 'following':
                this.statusBarItem.text = '$(eye) Following';
                this.statusBarItem.tooltip = 'File Change Follower: Active - Click to disable';
                this.statusBarItem.backgroundColor = new vscode.ThemeColor(
                    'statusBarItem.warningBackground'
                );
                break;
            case 'recording':
                this.statusBarItem.text = '$(record) Recording';
                this.statusBarItem.tooltip = 'File Change Follower: Recording - Click to stop';
                this.statusBarItem.backgroundColor = new vscode.ThemeColor(
                    'statusBarItem.errorBackground'
                );
                break;
            case 'playing':
                if (playbackStatus) {
                    this.statusBarItem.text = `$(play) ${playbackStatus.currentEvent}/${playbackStatus.totalEvents} (${playbackStatus.speed}x)`;
                    this.statusBarItem.tooltip = 'File Change Follower: Playing - Click to pause';
                } else {
                    this.statusBarItem.text = '$(play) Playing';
                    this.statusBarItem.tooltip = 'File Change Follower: Playing - Click to pause';
                }
                this.statusBarItem.backgroundColor = new vscode.ThemeColor(
                    'statusBarItem.warningBackground'
                );
                break;
            case 'paused':
                if (playbackStatus) {
                    this.statusBarItem.text = `$(debug-pause) ${playbackStatus.currentEvent}/${playbackStatus.totalEvents} (${playbackStatus.speed}x)`;
                    this.statusBarItem.tooltip = 'File Change Follower: Paused - Click to resume';
                } else {
                    this.statusBarItem.text = '$(debug-pause) Paused';
                    this.statusBarItem.tooltip = 'File Change Follower: Paused - Click to resume';
                }
                this.statusBarItem.backgroundColor = undefined;
                break;
            case 'idle':
            default:
                this.statusBarItem.text = '$(eye-closed) Not Following';
                this.statusBarItem.tooltip = 'File Change Follower: Inactive - Click to enable';
                this.statusBarItem.backgroundColor = undefined;
                break;
        }
    }

    /** @deprecated Use update(mode) instead */
    updateLegacy(isEnabled: boolean): void {
        this.update(isEnabled ? 'following' : 'idle');
    }

    getMode(): StatusBarMode {
        return this.currentMode;
    }

    setCommand(command: string): void {
        this.statusBarItem.command = command;
    }

    dispose(): void {
        this.statusBarItem.dispose();
    }
}
