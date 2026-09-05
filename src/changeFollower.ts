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
    private recentExternalChanges: Map<string, NodeJS.Timeout> = new Map();
    private readonly autoOpenedTabs = new Map<vscode.Tab, vscode.TabGroup>();
    private navigationQueue: Promise<void> = Promise.resolve();
    private followSession = 0;
    private tabTrackingGeneration = 0;
    private static readonly EXTERNAL_CHANGE_WINDOW_MS = 2000;
    private readonly _onDidAutoDisable = new vscode.EventEmitter<void>();
    readonly onDidAutoDisable = this._onDidAutoDisable.event;

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
        this.followSession++;
        this.setupListeners();
        vscode.window.showInformationMessage('File Change Follower: Follow mode enabled');
    }

    disable(silent = false): void {
        if (!this._isEnabled) {
            return;
        }

        this._isEnabled = false;
        this.followSession++;
        this.processChangesDebouncer?.cancel();
        this.clearListeners();
        this.pendingChanges.clear();
        this.clearAutoOpenedTabs();
        this.clearAllHighlights();
        this.clearAllExternalChangeTracking();
        if (!silent) {
            vscode.window.showInformationMessage('File Change Follower: Follow mode disabled');
        }
    }

    onConfigurationChanged(): void {
        this.setupDebouncer();
        this.setupHighlightDecoration();
        this.gitignoreCache.clear();
        if (!this.configManager.autoCloseOnSwitch) {
            this.clearAutoOpenedTabs();
        }
    }

    private setupDebouncer(): void {
        this.processChangesDebouncer?.cancel();
        this.processChangesDebouncer = debounce(
            () => this.processChanges(),
            this.configManager.debounceMs
        );
        if (this._isEnabled && this.pendingChanges.size > 0) {
            this.processChangesDebouncer.call();
        }
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

        const tabChangeListener = vscode.window.tabGroups.onDidChangeTabs((event) => {
            for (const tab of event.closed) {
                this.autoOpenedTabs.delete(tab);
            }
            for (const tab of event.changed) {
                if (tab.isDirty || tab.isPinned || this.autoOpenedTabs.get(tab) !== tab.group) {
                    this.autoOpenedTabs.delete(tab);
                }
            }
        });

        this.disposables.push(textChangeListener, fileWatcher, createListener, changeListener, tabChangeListener);
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

        // Detect manual edits: if the changed document is the active editor's document
        // and the change was NOT from an external file modification, the user is actively
        // editing. External changes are tracked via the file system watcher which fires
        // before VS Code reloads the document.
        if (this.configManager.disableOnManualEdit) {
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor && activeEditor.document.uri.toString() === uri.toString()) {
                const key = uri.toString();
                if (this.recentExternalChanges.has(key)) {
                    // Change originated from disk, not the user typing
                    this.clearExternalChangeTracking(key);
                } else {
                    this.disable(true);
                    this._onDidAutoDisable.fire();
                    vscode.window.showInformationMessage('File Change Follower: Follow mode auto-disabled due to manual edit');
                    return;
                }
            }
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
        // Track that this file was changed externally (on disk), so that when VS Code
        // reloads the document and fires onDidChangeTextDocument, we don't mistake
        // it for a manual user edit
        this.trackExternalChange(uri);

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

    private trackExternalChange(uri: vscode.Uri): void {
        const key = uri.toString();
        this.clearExternalChangeTracking(key);
        const timer = setTimeout(() => {
            this.recentExternalChanges.delete(key);
        }, ChangeFollower.EXTERNAL_CHANGE_WINDOW_MS);
        this.recentExternalChanges.set(key, timer);
    }

    private clearExternalChangeTracking(key: string): void {
        const existing = this.recentExternalChanges.get(key);
        if (existing) {
            clearTimeout(existing);
            this.recentExternalChanges.delete(key);
        }
    }

    private clearAllExternalChangeTracking(): void {
        for (const timer of this.recentExternalChanges.values()) {
            clearTimeout(timer);
        }
        this.recentExternalChanges.clear();
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

        const changeToShow = mostRecent;
        const session = this.followSession;
        // Opening and closing tabs must finish in order, even across debounce intervals.
        this.navigationQueue = this.navigationQueue.then(async () => {
            if (this.isCurrentSession(session)) {
                await this.showChange(changeToShow, session);
            }
        });
        await this.navigationQueue;
    }

    private isCurrentSession(session: number): boolean {
        return this._isEnabled && this.followSession === session;
    }

    private async showChange(change: PendingChange, session: number): Promise<void> {
        try {
            // Open the document
            const document = await vscode.workspace.openTextDocument(change.uri);
            if (!this.isCurrentSession(session)) {
                return;
            }

            // Snapshot tabs, not documents: include background tabs and all editor groups,
            // including tabs the user opened while the document was loading.
            const existingTabs = this.configManager.autoCloseOnSwitch
                ? new Set(this.getOpenTabs())
                : undefined;
            const trackingGeneration = this.tabTrackingGeneration;

            // Show the document without stealing focus from the terminal
            const editor = await vscode.window.showTextDocument(document, {
                preview: false,
                preserveFocus: true
            });
            if (!this.isCurrentSession(session)) {
                return;
            }

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

            if (existingTabs && this.configManager.autoCloseOnSwitch && trackingGeneration === this.tabTrackingGeneration) {
                const currentTab = vscode.window.tabGroups.all
                    .find(group => group.viewColumn === editor.viewColumn)?.tabs
                    .find(tab => tab.input instanceof vscode.TabInputText
                        && tab.input.uri.toString() === document.uri.toString());
                if (currentTab) {
                    if (!existingTabs.has(currentTab) && !currentTab.isDirty && !currentTab.isPinned) {
                        this.autoOpenedTabs.set(currentTab, currentTab.group);
                    }
                    await this.closeOtherAutoOpenedTabs(currentTab, session, trackingGeneration);
                }
            }
        } catch (error) {
            // File might have been deleted or is binary
            console.log(`File Change Follower: Could not open ${change.uri.fsPath}:`, error);
        }
    }

    private getOpenTabs(): vscode.Tab[] {
        return vscode.window.tabGroups.all.flatMap(group => [...group.tabs]);
    }

    private clearAutoOpenedTabs(): void {
        this.autoOpenedTabs.clear();
        this.tabTrackingGeneration++;
    }

    private async closeOtherAutoOpenedTabs(currentTab: vscode.Tab, session: number, trackingGeneration: number): Promise<void> {
        for (const [tab, group] of this.autoOpenedTabs) {
            if (!this.isCurrentSession(session) || !this.configManager.autoCloseOnSwitch
                || trackingGeneration !== this.tabTrackingGeneration) {
                return;
            }
            if (tab === currentTab) {
                continue;
            }

            const openTabs = this.getOpenTabs();
            if (!openTabs.includes(currentTab)) {
                return;
            }
            if (!openTabs.includes(tab) || tab.isDirty || tab.isPinned || tab.group !== group) {
                this.autoOpenedTabs.delete(tab);
                continue;
            }

            const label = tab.label;
            try {
                if (await vscode.window.tabGroups.close(tab, true)) {
                    this.autoOpenedTabs.delete(tab);
                } else {
                    console.log(`File Change Follower: Could not close tab ${label}: close was cancelled`);
                }
            } catch (error) {
                console.log(`File Change Follower: Could not close tab ${label}:`, error);
            }
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
        this._onDidAutoDisable.dispose();
        this.clearAllExternalChangeTracking();
        this.clearListeners();
    }
}
