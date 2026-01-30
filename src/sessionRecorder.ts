import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    RecordingEvent,
    RecordingMetadata,
    RecordingChange,
    RECORDING_FORMAT_VERSION,
    RECORDING_FILE_EXTENSION,
    serializeEvent,
    serializeMetadata,
    rangeToRecordingChange
} from './recording';
import { ConfigurationManager } from './configuration';

/**
 * Records file change events to a JSON Lines file
 */
export class SessionRecorder implements vscode.Disposable {
    private _isRecording = false;
    private recordingStartTime: number = 0;
    private recordingFilePath: string | undefined;
    private writeStream: fs.WriteStream | undefined;
    private eventCount = 0;
    private filesChanged: Set<string> = new Set();
    private readonly disposables: vscode.Disposable[] = [];
    private readonly configManager: ConfigurationManager;

    constructor(configManager: ConfigurationManager) {
        this.configManager = configManager;
    }

    get isRecording(): boolean {
        return this._isRecording;
    }

    get currentRecordingPath(): string | undefined {
        return this.recordingFilePath;
    }

    /**
     * Start recording file changes
     */
    async startRecording(): Promise<boolean> {
        if (this._isRecording) {
            vscode.window.showWarningMessage('Recording is already in progress');
            return false;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open');
            return false;
        }

        // Create recordings directory if it doesn't exist
        const recordingsDir = path.join(workspaceFolder.uri.fsPath, this.configManager.recordingsPath);
        try {
            if (!fs.existsSync(recordingsDir)) {
                fs.mkdirSync(recordingsDir, { recursive: true });
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create recordings directory: ${error}`);
            return false;
        }

        // Generate filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `recording-${timestamp}${RECORDING_FILE_EXTENSION}`;
        this.recordingFilePath = path.join(recordingsDir, filename);

        // Create write stream
        try {
            this.writeStream = fs.createWriteStream(this.recordingFilePath, { flags: 'a' });
            this.writeStream.on('error', (error) => {
                vscode.window.showErrorMessage(`Recording failed: ${error.message}`);
                this._isRecording = false;
                this.clearListeners();
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create recording file: ${error}`);
            return false;
        }

        // Write metadata as first line
        this.recordingStartTime = Date.now();
        const metadata: RecordingMetadata = {
            version: RECORDING_FORMAT_VERSION,
            startTime: new Date(this.recordingStartTime).toISOString(),
            workspaceName: workspaceFolder.name
        };
        this.writeStream.write(serializeMetadata(metadata) + '\n');

        // Reset counters
        this.eventCount = 0;
        this.filesChanged.clear();

        // Set up listeners
        this.setupListeners();

        this._isRecording = true;
        vscode.window.showInformationMessage('Recording started');
        return true;
    }

    /**
     * Stop recording and finalize the file
     */
    async stopRecording(): Promise<string | undefined> {
        if (!this._isRecording) {
            vscode.window.showWarningMessage('No recording in progress');
            return undefined;
        }

        // Clean up listeners
        this.clearListeners();

        // Close write stream and wait for it to finish flushing
        if (this.writeStream) {
            await new Promise<void>((resolve) => {
                this.writeStream?.end(() => resolve());
            });
            this.writeStream = undefined;
        }

        // Update metadata with final stats by rewriting the file
        await this.updateMetadataWithStats();

        this._isRecording = false;
        const filePath = this.recordingFilePath;
        
        vscode.window.showInformationMessage(
            `Recording saved: ${this.eventCount} events from ${this.filesChanged.size} files`,
            'Open Recording'
        ).then(selection => {
            if (selection === 'Open Recording' && filePath) {
                vscode.workspace.openTextDocument(filePath).then(doc => {
                    vscode.window.showTextDocument(doc);
                });
            }
        });

        return filePath;
    }

    /**
     * Record an edit event
     */
    recordEdit(filePath: string, changes: RecordingChange[]): void {
        if (!this._isRecording) {
            return;
        }

        const event: RecordingEvent = {
            timestamp: Date.now() - this.recordingStartTime,
            type: 'edit',
            filePath: this.getRelativePath(filePath),
            changes
        };

        this.writeEvent(event);
    }

    /**
     * Record a file creation event
     */
    recordCreate(filePath: string): void {
        if (!this._isRecording) {
            return;
        }

        const event: RecordingEvent = {
            timestamp: Date.now() - this.recordingStartTime,
            type: 'create',
            filePath: this.getRelativePath(filePath)
        };

        this.writeEvent(event);
    }

    /**
     * Record a file deletion event
     */
    recordDelete(filePath: string): void {
        if (!this._isRecording) {
            return;
        }

        const event: RecordingEvent = {
            timestamp: Date.now() - this.recordingStartTime,
            type: 'delete',
            filePath: this.getRelativePath(filePath)
        };

        this.writeEvent(event);
    }

    private writeEvent(event: RecordingEvent): void {
        if (this.writeStream) {
            this.writeStream.write(serializeEvent(event) + '\n');
            this.eventCount++;
            this.filesChanged.add(event.filePath);
        }
    }

    private getRelativePath(absolutePath: string): string {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            return path.relative(workspaceFolder.uri.fsPath, absolutePath);
        }
        return absolutePath;
    }

    private setupListeners(): void {
        // Listen for text document changes
        const textChangeListener = vscode.workspace.onDidChangeTextDocument((event) => {
            if (!this._isRecording || event.document.uri.scheme !== 'file') {
                return;
            }

            if (event.contentChanges.length === 0) {
                return;
            }

            const changes: RecordingChange[] = event.contentChanges.map(change => 
                rangeToRecordingChange(change.range, change.text)
            );

            this.recordEdit(event.document.uri.fsPath, changes);
        });

        // Listen for file creation
        const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
        
        const createListener = fileWatcher.onDidCreate((uri) => {
            if (this._isRecording) {
                this.recordCreate(uri.fsPath);
            }
        });

        const deleteListener = fileWatcher.onDidDelete((uri) => {
            if (this._isRecording) {
                this.recordDelete(uri.fsPath);
            }
        });

        this.disposables.push(textChangeListener, fileWatcher, createListener, deleteListener);
    }

    private clearListeners(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables.length = 0;
    }

    private async updateMetadataWithStats(): Promise<void> {
        if (!this.recordingFilePath) {
            return;
        }

        try {
            const content = fs.readFileSync(this.recordingFilePath, 'utf8');
            const lines = content.split('\n');
            
            if (lines.length > 0) {
                // Parse and update the first line (metadata)
                const metadata = JSON.parse(lines[0]);
                metadata.endTime = new Date().toISOString();
                metadata.eventCount = this.eventCount;
                metadata.fileCount = this.filesChanged.size;
                
                lines[0] = JSON.stringify(metadata);
                fs.writeFileSync(this.recordingFilePath, lines.join('\n'));
            }
        } catch (error) {
            console.error('Failed to update recording metadata:', error);
        }
    }

    dispose(): void {
        if (this._isRecording) {
            this.stopRecording();
        }
        this.clearListeners();
    }
}
