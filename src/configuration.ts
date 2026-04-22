import * as vscode from 'vscode';

export class ConfigurationManager {
    private config: vscode.WorkspaceConfiguration;

    constructor() {
        this.config = vscode.workspace.getConfiguration('fileChangeFollower');
    }

    reload(): void {
        this.config = vscode.workspace.getConfiguration('fileChangeFollower');
    }

    get enabled(): boolean {
        return this.config.get<boolean>('enabled', false);
    }

    get includePatterns(): string[] {
        return this.config.get<string[]>('includePatterns', ['**/*']);
    }

    get excludePatterns(): string[] {
        return this.config.get<string[]>('excludePatterns', [
            '**/node_modules/**',
            '**/.git/**',
            '**/out/**',
            '**/dist/**',
            '**/*.vsix'
        ]);
    }

    get disableOnManualEdit(): boolean {
        return this.config.get<boolean>('disableOnManualEdit', true);
    }

    get debounceMs(): number {
        return this.config.get<number>('debounceMs', 150);
    }

    get highlightDuration(): number {
        return this.config.get<number>('highlightDuration', 2000);
    }

    get respectGitignore(): boolean {
        return this.config.get<boolean>('respectGitignore', true);
    }

    get recordingsPath(): string {
        return this.config.get<string>('recordingsPath', '.recordings');
    }

    get liveDelaySeconds(): number {
        return this.config.get<number>('liveDelaySeconds', 0);
    }

    get autoSaveOnChange(): boolean {
        return this.config.get<boolean>('autoSaveOnChange', false);
    }

    get defaultPlaybackSpeed(): number {
        return this.config.get<number>('defaultPlaybackSpeed', 1);
    }
}
