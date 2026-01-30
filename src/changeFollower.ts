import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { minimatch } from 'minimatch';
import ignore, { Ignore } from 'ignore';
import { ConfigurationManager } from './configuration';
import { debounce, Debouncer } from './debounce';

interface PendingChange {
    uri: vscode.Uri;
    ranges: vscode.Range[];
    timestamp: number;
}

export class ChangeFollower implements vscode.Disposable {
    private _isEnabled = false;
    private readonly disposables: vscode.Disposable[] = [];
    private readonly configManager: ConfigurationManager;
    private readonly pendingChanges: Map<string, PendingChange> = new Map();
    private processChangesDebouncer: Debouncer | undefined;
    private highlightDecorationType: vscode.TextEditorDecorationType | undefined;
    private activeHighlights: Map<string, NodeJS.Timeout> = new Map();
    private gitignoreCache: Map<string, Ignore> = new Map();

    constructor(configManager: ConfigurationManager) {
        this.configManager = configManager;
        this.setupHighlightDecoration();
        this.setupDebouncer();
    }

    get isEnabled(): boolean {
        return this._isEnabled;
    }

    toggle(): void {
        if (this._isEnabled) {
            this.disable();
        } else {
            this.enable();
        }
    }

    enable(): void {
        if (this._isEnabled) {
            return;
        }

        this._isEnabled = true;
        this.setupListeners();
        vscode.window.showInformationMessage('File Change Follower: Follow mode enabled');
    }

    disable(): void {
        if (!this._isEnabled) {
            return;
        }

        this._isEnabled = false;
        this.clearListeners();
        this.pendingChanges.clear();
        this.clearAllHighlights();
        vscode.window.showInformationMessage('File Change Follower: Follow mode disabled');
    }

    onConfigurationChanged(): void {
        this.setupDebouncer();
        this.setupHighlightDecoration();
        this.gitignoreCache.clear();
    }

    private setupDebouncer(): void {
        this.processChangesDebouncer = debounce(
            () => this.processChanges(),
            this.configManager.debounceMs
        );
    }

    private setupHighlightDecoration(): void {
        this.highlightDecorationType?.dispose();
        this.highlightDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('diffEditor.insertedTextBackground'),
            isWholeLine: true
        });
    }

    private setupListeners(): void {
        // Listen for text document changes (edits to open documents)
        const textChangeListener = vscode.workspace.onDidChangeTextDocument((event) => {
            if (!this._isEnabled) {
                return;
            }
            this.handleTextDocumentChange(event);
        });

        // Listen for file creation
        const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
        
        const createListener = fileWatcher.onDidCreate((uri) => {
            if (!this._isEnabled) {
                return;
            }
            this.handleFileCreated(uri);
        });

        const changeListener = fileWatcher.onDidChange((uri) => {
            if (!this._isEnabled) {
                return;
            }
            this.handleFileChanged(uri);
        });

        this.disposables.push(textChangeListener, fileWatcher, createListener, changeListener);
    }

    private clearListeners(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables.length = 0;
    }

    private handleTextDocumentChange(event: vscode.TextDocumentChangeEvent): void {
        const uri = event.document.uri;

        // Skip non-file schemes
        if (uri.scheme !== 'file') {
            return;
        }

        // Skip if no content changes
        if (event.contentChanges.length === 0) {
            return;
        }

        // Check if file matches patterns
        if (!this.shouldFollowFile(uri)) {
            return;
        }

        // Convert content changes to ranges
        const ranges = event.contentChanges.map(change => {
            // For insertions/replacements, use the range after the change
            const startLine = change.range.start.line;
            const lineCount = change.text.split('\n').length;
            const endLine = startLine + lineCount - 1;
            return new vscode.Range(startLine, 0, endLine, 0);
        });

        this.queueChange(uri, ranges);
    }

    private handleFileCreated(uri: vscode.Uri): void {
        if (!this.shouldFollowFile(uri)) {
            return;
        }

        // Queue showing the new file at the beginning
        this.queueChange(uri, [new vscode.Range(0, 0, 0, 0)]);
    }

    private handleFileChanged(uri: vscode.Uri): void {
        // File changed externally - only handle if not already open
        const openDocument = vscode.workspace.textDocuments.find(
            doc => doc.uri.toString() === uri.toString()
        );

        if (openDocument) {
            // Already open, will be handled by onDidChangeTextDocument
            return;
        }

        if (!this.shouldFollowFile(uri)) {
            return;
        }

        // Queue showing the file (we don't know where the change is)
        this.queueChange(uri, [new vscode.Range(0, 0, 0, 0)]);
    }

    private shouldFollowFile(uri: vscode.Uri): boolean {
        const relativePath = vscode.workspace.asRelativePath(uri, false);

        // Check exclude patterns first
        for (const pattern of this.configManager.excludePatterns) {
            if (minimatch(relativePath, pattern, { dot: true })) {
                return false;
            }
        }

        // Check .gitignore if enabled
        if (this.configManager.respectGitignore && this.isIgnoredByGitignore(uri)) {
            return false;
        }

        // Check include patterns
        for (const pattern of this.configManager.includePatterns) {
            if (minimatch(relativePath, pattern, { dot: true })) {
                return true;
            }
        }

        return false;
    }

    private isIgnoredByGitignore(uri: vscode.Uri): boolean {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
            return false;
        }

        const workspaceRoot = workspaceFolder.uri.fsPath;
        const ig = this.getGitignore(workspaceRoot);
        if (!ig) {
            return false;
        }

        const relativePath = path.relative(workspaceRoot, uri.fsPath);
        // Normalize path separators for cross-platform compatibility
        const normalizedPath = relativePath.split(path.sep).join('/');
        return ig.ignores(normalizedPath);
    }

    private getGitignore(workspaceRoot: string): Ignore | undefined {
        if (this.gitignoreCache.has(workspaceRoot)) {
            return this.gitignoreCache.get(workspaceRoot);
        }

        const gitignorePath = path.join(workspaceRoot, '.gitignore');
        try {
            if (fs.existsSync(gitignorePath)) {
                const content = fs.readFileSync(gitignorePath, 'utf8');
                const ig = ignore().add(content);
                this.gitignoreCache.set(workspaceRoot, ig);
                return ig;
            }
        } catch {
            // Failed to read .gitignore, continue without it
        }

        return undefined;
    }

    private queueChange(uri: vscode.Uri, ranges: vscode.Range[]): void {
        const key = uri.toString();
        const existing = this.pendingChanges.get(key);

        if (existing) {
            // Merge ranges
            existing.ranges.push(...ranges);
            existing.timestamp = Date.now();
        } else {
            this.pendingChanges.set(key, {
                uri,
                ranges,
                timestamp: Date.now()
            });
        }

        this.processChangesDebouncer?.call();
    }

    private async processChanges(): Promise<void> {
        if (!this._isEnabled || this.pendingChanges.size === 0) {
            return;
        }

        // Get the most recent change
        let mostRecent: PendingChange | undefined;
        for (const change of this.pendingChanges.values()) {
            if (!mostRecent || change.timestamp > mostRecent.timestamp) {
                mostRecent = change;
            }
        }

        // Clear pending changes
        this.pendingChanges.clear();

        if (!mostRecent) {
            return;
        }

        await this.showChange(mostRecent);
    }

    private async showChange(change: PendingChange): Promise<void> {
        try {
            // Open the document
            const document = await vscode.workspace.openTextDocument(change.uri);
            
            // Show the document without stealing focus from the terminal
            const editor = await vscode.window.showTextDocument(document, {
                preview: false,
                preserveFocus: true
            });

            // Find the best range to reveal (prefer last change)
            const rangeToReveal = change.ranges.length > 0 
                ? change.ranges[change.ranges.length - 1]
                : new vscode.Range(0, 0, 0, 0);

            // Scroll to the change
            editor.revealRange(rangeToReveal, vscode.TextEditorRevealType.InCenter);

            // Highlight the changed lines
            if (this.configManager.highlightDuration > 0 && this.highlightDecorationType) {
                this.applyHighlight(editor, change.ranges);
            }
        } catch (error) {
            // File might have been deleted or is binary
            console.log(`File Change Follower: Could not open ${change.uri.fsPath}:`, error);
        }
    }

    private applyHighlight(editor: vscode.TextEditor, ranges: vscode.Range[]): void {
        if (!this.highlightDecorationType) {
            return;
        }

        const key = editor.document.uri.toString();

        // Clear existing highlight timer for this file
        const existingTimer = this.activeHighlights.get(key);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Apply highlight
        editor.setDecorations(this.highlightDecorationType, ranges);

        // Schedule removal
        const timer = setTimeout(() => {
            if (this.highlightDecorationType) {
                // Find the editor again as it might have changed
                const currentEditor = vscode.window.visibleTextEditors.find(
                    e => e.document.uri.toString() === key
                );
                if (currentEditor) {
                    currentEditor.setDecorations(this.highlightDecorationType, []);
                }
            }
            this.activeHighlights.delete(key);
        }, this.configManager.highlightDuration);

        this.activeHighlights.set(key, timer);
    }

    private clearAllHighlights(): void {
        for (const timer of this.activeHighlights.values()) {
            clearTimeout(timer);
        }
        this.activeHighlights.clear();

        if (this.highlightDecorationType) {
            for (const editor of vscode.window.visibleTextEditors) {
                editor.setDecorations(this.highlightDecorationType, []);
            }
        }
    }

    dispose(): void {
        this.disable();
        this.highlightDecorationType?.dispose();
        this.clearListeners();
    }
}
