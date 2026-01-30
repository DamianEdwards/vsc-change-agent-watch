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

    get debounceMs(): number {
        return this.config.get<number>('debounceMs', 150);
    }

    get highlightDuration(): number {
        return this.config.get<number>('highlightDuration', 2000);
    }
}
