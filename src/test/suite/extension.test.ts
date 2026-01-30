import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('DamianEdwards.file-change-follower'));
    });

    test('Commands should be registered', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('fileChangeFollower.toggle'));
        assert.ok(commands.includes('fileChangeFollower.enable'));
        assert.ok(commands.includes('fileChangeFollower.disable'));
    });
});
