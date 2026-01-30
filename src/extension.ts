import * as vscode from 'vscode';
import { ChangeFollower } from './changeFollower';
import { StatusBarManager } from './statusBar';
import { ConfigurationManager } from './configuration';

let changeFollower: ChangeFollower | undefined;
let statusBarManager: StatusBarManager | undefined;
let configManager: ConfigurationManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
    console.log('File Change Follower is now active');

    configManager = new ConfigurationManager();
    statusBarManager = new StatusBarManager();
    changeFollower = new ChangeFollower(configManager);

    // Register commands
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
        configChangeListener,
        statusBarManager,
        changeFollower
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
    if (statusBarManager && changeFollower) {
        statusBarManager.update(changeFollower.isEnabled);
    }
}

export function deactivate(): void {
    changeFollower?.dispose();
    statusBarManager?.dispose();
    changeFollower = undefined;
    statusBarManager = undefined;
    configManager = undefined;
}
