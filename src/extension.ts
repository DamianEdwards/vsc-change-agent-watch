import * as vscode from 'vscode';
import { ChangeFollower } from './changeFollower';
import { StatusBarManager, StatusBarMode } from './statusBar';
import { ConfigurationManager } from './configuration';
import { SessionRecorder } from './sessionRecorder';
import { RecordingPlayer } from './recordingPlayer';
import { LiveDelayBuffer } from './liveDelayBuffer';
import { TimelineWebviewProvider } from './timelineWebview';

let changeFollower: ChangeFollower | undefined;
let statusBarManager: StatusBarManager | undefined;
let configManager: ConfigurationManager | undefined;
let sessionRecorder: SessionRecorder | undefined;
let recordingPlayer: RecordingPlayer | undefined;
let liveDelayBuffer: LiveDelayBuffer | undefined;
let timelineProvider: TimelineWebviewProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
    console.log('File Change Follower is now active');

    configManager = new ConfigurationManager();
    statusBarManager = new StatusBarManager();
    changeFollower = new ChangeFollower(configManager);
    sessionRecorder = new SessionRecorder(configManager);
    recordingPlayer = new RecordingPlayer(configManager);
    liveDelayBuffer = new LiveDelayBuffer(configManager);
    timelineProvider = new TimelineWebviewProvider(context.extensionUri);

    // Wire up player to timeline
    timelineProvider.setPlayer(recordingPlayer);

    // Register webview provider
    const timelineView = vscode.window.registerWebviewViewProvider(
        TimelineWebviewProvider.viewType,
        timelineProvider
    );

    // Listen to player state changes to update status bar
    const playerStateListener = recordingPlayer.onStateChange((state) => {
        if (state.state === 'stopped' && !sessionRecorder?.isRecording) {
            updateStatusBar();
        } else if (state.state === 'playing') {
            statusBarManager?.update('playing', {
                currentEvent: state.currentEventIndex,
                totalEvents: state.totalEvents,
                speed: state.speed
            });
        } else if (state.state === 'paused') {
            statusBarManager?.update('paused', {
                currentEvent: state.currentEventIndex,
                totalEvents: state.totalEvents,
                speed: state.speed
            });
        }
    });

    // Register follow mode commands
    const toggleCommand = vscode.commands.registerCommand(
        'fileChangeFollower.toggle',
        () => {
            if (changeFollower) {
                changeFollower.toggle();
                updateStatusBar();
            }
        }
    );

    const enableCommand = vscode.commands.registerCommand(
        'fileChangeFollower.enable',
        () => {
            if (changeFollower) {
                changeFollower.enable();
                updateStatusBar();
            }
        }
    );

    const disableCommand = vscode.commands.registerCommand(
        'fileChangeFollower.disable',
        () => {
            if (changeFollower) {
                changeFollower.disable();
                updateStatusBar();
            }
        }
    );

    // Register recording commands
    const startRecordingCommand = vscode.commands.registerCommand(
        'fileChangeFollower.startRecording',
        async () => {
            if (recordingPlayer?.state === 'playing') {
                vscode.window.showWarningMessage('Cannot record while playing');
                return;
            }
            const success = await sessionRecorder?.startRecording();
            if (success) {
                statusBarManager?.update('recording');
            }
        }
    );

    const stopRecordingCommand = vscode.commands.registerCommand(
        'fileChangeFollower.stopRecording',
        async () => {
            await sessionRecorder?.stopRecording();
            updateStatusBar();
        }
    );

    const openRecordingCommand = vscode.commands.registerCommand(
        'fileChangeFollower.openRecording',
        async () => {
            await recordingPlayer?.openRecording();
            vscode.commands.executeCommand('setContext', 'fileChangeFollower.hasRecording', recordingPlayer?.isLoaded);
        }
    );

    // Register playback commands
    const playRecordingCommand = vscode.commands.registerCommand(
        'fileChangeFollower.playRecording',
        () => {
            if (sessionRecorder?.isRecording) {
                vscode.window.showWarningMessage('Cannot play while recording');
                return;
            }
            recordingPlayer?.play();
        }
    );

    const pausePlaybackCommand = vscode.commands.registerCommand(
        'fileChangeFollower.pausePlayback',
        () => {
            recordingPlayer?.pause();
        }
    );

    const stopPlaybackCommand = vscode.commands.registerCommand(
        'fileChangeFollower.stopPlayback',
        () => {
            recordingPlayer?.stop();
        }
    );

    const skipForwardCommand = vscode.commands.registerCommand(
        'fileChangeFollower.skipForward',
        () => {
            recordingPlayer?.skipForward();
        }
    );

    const skipBackwardCommand = vscode.commands.registerCommand(
        'fileChangeFollower.skipBackward',
        () => {
            recordingPlayer?.skipBackward();
        }
    );

    const speedUpCommand = vscode.commands.registerCommand(
        'fileChangeFollower.speedUp',
        () => {
            recordingPlayer?.speedUp();
        }
    );

    const slowDownCommand = vscode.commands.registerCommand(
        'fileChangeFollower.slowDown',
        () => {
            recordingPlayer?.slowDown();
        }
    );

    // Register live delay commands
    const toggleLiveDelayCommand = vscode.commands.registerCommand(
        'fileChangeFollower.toggleLiveDelay',
        () => {
            liveDelayBuffer?.toggle();
        }
    );

    const catchUpToLiveCommand = vscode.commands.registerCommand(
        'fileChangeFollower.catchUpToLive',
        () => {
            liveDelayBuffer?.catchUpToLive();
        }
    );

    // Register timeline command
    const showTimelineCommand = vscode.commands.registerCommand(
        'fileChangeFollower.showTimeline',
        () => {
            vscode.commands.executeCommand('fileChangeFollower.timeline.focus');
        }
    );

    // Listen for auto-disable events from ChangeFollower
    const autoDisableListener = changeFollower.onDidAutoDisable(() => {
        updateStatusBar();
    });

    // Listen to configuration changes
    const configChangeListener = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('fileChangeFollower')) {
            configManager?.reload();
            changeFollower?.onConfigurationChanged();
        }
    });

    context.subscriptions.push(
        toggleCommand,
        enableCommand,
        disableCommand,
        startRecordingCommand,
        stopRecordingCommand,
        openRecordingCommand,
        playRecordingCommand,
        pausePlaybackCommand,
        stopPlaybackCommand,
        skipForwardCommand,
        skipBackwardCommand,
        speedUpCommand,
        slowDownCommand,
        toggleLiveDelayCommand,
        catchUpToLiveCommand,
        showTimelineCommand,
        configChangeListener,
        autoDisableListener,
        playerStateListener,
        timelineView,
        statusBarManager,
        changeFollower,
        sessionRecorder,
        recordingPlayer,
        liveDelayBuffer
    );

    // Set initial status bar click command
    statusBarManager.setCommand('fileChangeFollower.toggle');

    // Initialize based on configuration
    if (configManager.enabled) {
        changeFollower.enable();
    }
    updateStatusBar();
}

function updateStatusBar(): void {
    if (!statusBarManager) {
        return;
    }

    let mode: StatusBarMode = 'idle';

    if (sessionRecorder?.isRecording) {
        mode = 'recording';
    } else if (recordingPlayer?.state === 'playing') {
        mode = 'playing';
    } else if (recordingPlayer?.state === 'paused') {
        mode = 'paused';
    } else if (changeFollower?.isEnabled) {
        mode = 'following';
    }

    if (mode === 'playing' || mode === 'paused') {
        statusBarManager.update(mode, {
            currentEvent: recordingPlayer?.currentIndex ?? 0,
            totalEvents: recordingPlayer?.totalEvents ?? 0,
            speed: recordingPlayer?.speed ?? 1
        });
    } else {
        statusBarManager.update(mode);
    }
}

export function deactivate(): void {
    changeFollower?.dispose();
    statusBarManager?.dispose();
    sessionRecorder?.dispose();
    recordingPlayer?.dispose();
    liveDelayBuffer?.dispose();
    timelineProvider?.dispose();
    changeFollower = undefined;
    statusBarManager = undefined;
    configManager = undefined;
    sessionRecorder = undefined;
    recordingPlayer = undefined;
    liveDelayBuffer = undefined;
    timelineProvider = undefined;
}
