import * as vscode from 'vscode';
import { RecordingPlayer, PlaybackStateChangeEvent } from './recordingPlayer';

/**
 * Provides the timeline webview panel for playback visualization and control
 */
export class TimelineWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'fileChangeFollower.timeline';

    private webviewView: vscode.WebviewView | undefined;
    private player: RecordingPlayer | undefined;
    private playerSubscription: vscode.Disposable | undefined;

    constructor(private readonly extensionUri: vscode.Uri) {}

    /**
     * Set the player to sync with the timeline
     */
    setPlayer(player: RecordingPlayer): void {
        // Clean up old subscription
        this.playerSubscription?.dispose();
        
        this.player = player;
        
        // Subscribe to player state changes
        this.playerSubscription = player.onStateChange((state) => {
            this.updateWebview(state);
        });

        // Initial update
        this.updateWebview({
            state: player.state,
            currentEventIndex: player.currentIndex,
            totalEvents: player.totalEvents,
            speed: player.speed
        });
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _context: vscode.WebviewViewResolveContext,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _token: vscode.CancellationToken
    ): void {
        this.webviewView = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = this.getHtmlContent();

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage((message) => {
            this.handleMessage(message);
        });

        // Initial state if player is already set
        if (this.player) {
            this.updateWebview({
                state: this.player.state,
                currentEventIndex: this.player.currentIndex,
                totalEvents: this.player.totalEvents,
                speed: this.player.speed
            });
        }
    }

    private updateWebview(state: PlaybackStateChangeEvent): void {
        this.webviewView?.webview.postMessage({
            type: 'updateState',
            ...state
        });
    }

    private handleMessage(message: { command: string; value?: number }): void {
        if (!this.player) {
            return;
        }

        switch (message.command) {
            case 'play':
                this.player.play();
                break;
            case 'pause':
                this.player.pause();
                break;
            case 'stop':
                this.player.stop();
                break;
            case 'skipForward':
                this.player.skipForward();
                break;
            case 'skipBackward':
                this.player.skipBackward();
                break;
            case 'seekTo':
                if (typeof message.value === 'number') {
                    this.player.seekTo(message.value);
                }
                break;
            case 'setSpeed':
                if (typeof message.value === 'number') {
                    this.player.setSpeed(message.value);
                }
                break;
        }
    }

    private getHtmlContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Playback Timeline</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-sideBar-background);
            padding: 10px;
        }
        .container {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .controls {
            display: flex;
            justify-content: center;
            gap: 5px;
            align-items: center;
        }
        .btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 5px 10px;
            cursor: pointer;
            border-radius: 3px;
            font-size: 14px;
        }
        .btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .timeline-container {
            position: relative;
            height: 30px;
            background: var(--vscode-input-background);
            border-radius: 3px;
            cursor: pointer;
        }
        .timeline-progress {
            position: absolute;
            left: 0;
            top: 0;
            height: 100%;
            background: var(--vscode-progressBar-background);
            border-radius: 3px;
            transition: width 0.1s ease;
        }
        .timeline-playhead {
            position: absolute;
            top: -2px;
            width: 4px;
            height: 34px;
            background: var(--vscode-focusBorder);
            border-radius: 2px;
            transform: translateX(-50%);
            cursor: grab;
        }
        .status {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .speed-select {
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            padding: 3px 5px;
            border-radius: 3px;
            cursor: pointer;
        }
        .no-recording {
            text-align: center;
            padding: 20px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="controls">
            <button class="btn" id="skipBackward" title="Skip Backward">⏮</button>
            <button class="btn" id="playPause" title="Play/Pause">▶</button>
            <button class="btn" id="stop" title="Stop">⏹</button>
            <button class="btn" id="skipForward" title="Skip Forward">⏭</button>
            <select class="speed-select" id="speedSelect" title="Playback Speed">
                <option value="0.25">0.25x</option>
                <option value="0.5">0.5x</option>
                <option value="1" selected>1x</option>
                <option value="2">2x</option>
                <option value="4">4x</option>
            </select>
        </div>
        <div class="timeline-container" id="timeline">
            <div class="timeline-progress" id="progress"></div>
            <div class="timeline-playhead" id="playhead"></div>
        </div>
        <div class="status">
            <span id="position">0 / 0</span>
            <span id="state">Stopped</span>
        </div>
    </div>
    <div class="no-recording" id="noRecording" style="display: none;">
        No recording loaded.<br>
        Use "Open Recording" command to load a file.
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        const playPauseBtn = document.getElementById('playPause');
        const stopBtn = document.getElementById('stop');
        const skipForwardBtn = document.getElementById('skipForward');
        const skipBackwardBtn = document.getElementById('skipBackward');
        const speedSelect = document.getElementById('speedSelect');
        const timeline = document.getElementById('timeline');
        const progress = document.getElementById('progress');
        const playhead = document.getElementById('playhead');
        const positionEl = document.getElementById('position');
        const stateEl = document.getElementById('state');
        const container = document.querySelector('.container');
        const noRecording = document.getElementById('noRecording');

        let currentState = 'stopped';
        let totalEvents = 0;
        let currentIndex = 0;

        playPauseBtn.addEventListener('click', () => {
            vscode.postMessage({ command: currentState === 'playing' ? 'pause' : 'play' });
        });

        stopBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'stop' });
        });

        skipForwardBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'skipForward' });
        });

        skipBackwardBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'skipBackward' });
        });

        speedSelect.addEventListener('change', (e) => {
            vscode.postMessage({ command: 'setSpeed', value: parseFloat(e.target.value) });
        });

        timeline.addEventListener('click', (e) => {
            if (totalEvents === 0) return;
            const rect = timeline.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            const index = Math.floor(percent * totalEvents);
            vscode.postMessage({ command: 'seekTo', value: index });
        });

        window.addEventListener('message', (event) => {
            const message = event.data;
            if (message.type === 'updateState') {
                currentState = message.state;
                currentIndex = message.currentEventIndex;
                totalEvents = message.totalEvents;

                // Update UI
                if (totalEvents === 0) {
                    container.style.display = 'none';
                    noRecording.style.display = 'block';
                } else {
                    container.style.display = 'flex';
                    noRecording.style.display = 'none';
                }

                const percent = totalEvents > 0 ? (currentIndex / totalEvents) * 100 : 0;
                progress.style.width = percent + '%';
                playhead.style.left = percent + '%';

                positionEl.textContent = currentIndex + ' / ' + totalEvents;
                stateEl.textContent = currentState.charAt(0).toUpperCase() + currentState.slice(1);

                playPauseBtn.textContent = currentState === 'playing' ? '⏸' : '▶';
                speedSelect.value = message.speed.toString();
            }
        });
    </script>
</body>
</html>`;
    }

    dispose(): void {
        this.playerSubscription?.dispose();
    }
}
