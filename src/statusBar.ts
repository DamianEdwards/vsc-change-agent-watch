import * as vscode from 'vscode';

export class StatusBarManager implements vscode.Disposable {
    private readonly statusBarItem: vscode.StatusBarItem;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.update(false);
        this.statusBarItem.show();
    }

    update(isEnabled: boolean): void {
        if (isEnabled) {
            this.statusBarItem.text = '$(eye) Following';
            this.statusBarItem.tooltip = 'File Change Follower: Active - Click to disable';
            this.statusBarItem.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.warningBackground'
            );
        } else {
            this.statusBarItem.text = '$(eye-closed) Not Following';
            this.statusBarItem.tooltip = 'File Change Follower: Inactive - Click to enable';
            this.statusBarItem.backgroundColor = undefined;
        }
    }

    setCommand(command: string): void {
        this.statusBarItem.command = command;
    }

    dispose(): void {
        this.statusBarItem.dispose();
    }
}
