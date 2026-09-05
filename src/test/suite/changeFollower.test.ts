import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ChangeFollower } from '../../changeFollower';
import { ConfigurationManager } from '../../configuration';

suite('ChangeFollower Auto-Disable Test Suite', () => {
    let configManager: ConfigurationManager;
    let changeFollower: ChangeFollower;
    let tempDir: string;

    setup(() => {
        configManager = new ConfigurationManager();
        changeFollower = new ChangeFollower(configManager);
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcf-test-'));
    });

    teardown(() => {
        changeFollower.dispose();
        // Clean up temp files
        try {
            fs.rmSync(tempDir, { recursive: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    test('Should auto-disable when active editor document is changed', async () => {
        // Enable follow mode
        changeFollower.enable();
        assert.strictEqual(changeFollower.isEnabled, true);

        // Create and open a temp file so it becomes the active editor
        const tempFile = path.join(tempDir, 'test-manual-edit.txt');
        fs.writeFileSync(tempFile, 'initial content');
        const uri = vscode.Uri.file(tempFile);
        const doc = await vscode.workspace.openTextDocument(uri);
        // Open without preserveFocus so it becomes the active editor
        const editor = await vscode.window.showTextDocument(doc, { preserveFocus: false });

        // Verify the active editor is our document
        assert.strictEqual(vscode.window.activeTextEditor?.document.uri.toString(), uri.toString());

        // Track auto-disable event
        let autoDisableFired = false;
        const disposable = changeFollower.onDidAutoDisable(() => {
            autoDisableFired = true;
        });

        // Simulate a manual edit by typing into the active editor
        await editor.edit(editBuilder => {
            editBuilder.insert(new vscode.Position(0, 0), 'manual edit ');
        });

        // Give a moment for the event to propagate
        await new Promise(resolve => setTimeout(resolve, 200));

        // Follow mode should be auto-disabled
        assert.strictEqual(changeFollower.isEnabled, false, 'Follow mode should be auto-disabled after manual edit');
        assert.strictEqual(autoDisableFired, true, 'onDidAutoDisable event should have fired');

        disposable.dispose();
    });

    test('Should NOT auto-disable when a non-active document is changed externally', async () => {
        // Enable follow mode
        changeFollower.enable();
        assert.strictEqual(changeFollower.isEnabled, true);

        // Create a temp file and open it as the active editor
        const activeFile = path.join(tempDir, 'active-file.txt');
        fs.writeFileSync(activeFile, 'active content');
        const activeUri = vscode.Uri.file(activeFile);
        const activeDoc = await vscode.workspace.openTextDocument(activeUri);
        await vscode.window.showTextDocument(activeDoc, { preserveFocus: false });

        // Create a different temp file and modify it externally (not the active editor)
        const externalFile = path.join(tempDir, 'external-file.txt');
        fs.writeFileSync(externalFile, 'initial content');

        // Track auto-disable event
        let autoDisableFired = false;
        const disposable = changeFollower.onDidAutoDisable(() => {
            autoDisableFired = true;
        });

        // Modify the external file on disk
        fs.writeFileSync(externalFile, 'modified externally');

        // Give a moment for events to propagate
        await new Promise(resolve => setTimeout(resolve, 500));

        // Follow mode should still be enabled
        assert.strictEqual(changeFollower.isEnabled, true, 'Follow mode should remain enabled for external changes');
        assert.strictEqual(autoDisableFired, false, 'onDidAutoDisable should NOT have fired');

        disposable.dispose();
    });

    test('Should NOT auto-disable when disableOnManualEdit setting is disabled', async () => {
        // Enable follow mode
        changeFollower.enable();
        assert.strictEqual(changeFollower.isEnabled, true);

        // Update the setting to disable auto-disable
        await vscode.workspace.getConfiguration('fileChangeFollower').update('disableOnManualEdit', false, vscode.ConfigurationTarget.Global);
        configManager.reload();

        // Create and open a temp file so it becomes the active editor
        const tempFile = path.join(tempDir, 'test-no-auto-disable.txt');
        fs.writeFileSync(tempFile, 'initial content');
        const uri = vscode.Uri.file(tempFile);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, { preserveFocus: false });

        // Track auto-disable event
        let autoDisableFired = false;
        const disposable = changeFollower.onDidAutoDisable(() => {
            autoDisableFired = true;
        });

        // Simulate a manual edit
        await editor.edit(editBuilder => {
            editBuilder.insert(new vscode.Position(0, 0), 'manual edit ');
        });

        // Give a moment for events to propagate
        await new Promise(resolve => setTimeout(resolve, 200));

        // Follow mode should still be enabled
        assert.strictEqual(changeFollower.isEnabled, true, 'Follow mode should remain enabled when disableOnManualEdit is false');
        assert.strictEqual(autoDisableFired, false, 'onDidAutoDisable should NOT have fired');

        // Clean up the setting
        await vscode.workspace.getConfiguration('fileChangeFollower').update('disableOnManualEdit', undefined, vscode.ConfigurationTarget.Global);
        disposable.dispose();
    });

    test('Should NOT auto-disable when external process modifies active editor document', async () => {
        // This is the core bug scenario: user has a file focused, CLI agent modifies it
        // on disk, VS Code reloads it, and follow mode should NOT be disabled.
        changeFollower.enable();
        assert.strictEqual(changeFollower.isEnabled, true);

        // Create and open a temp file as the active editor (user is reading it)
        const tempFile = path.join(tempDir, 'test-external-active.txt');
        fs.writeFileSync(tempFile, 'initial content');
        const uri = vscode.Uri.file(tempFile);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preserveFocus: false });

        // Verify it's the active editor
        assert.strictEqual(vscode.window.activeTextEditor?.document.uri.toString(), uri.toString());

        // Track auto-disable event
        let autoDisableFired = false;
        const disposable = changeFollower.onDidAutoDisable(() => {
            autoDisableFired = true;
        });

        // Simulate an external process (CLI agent) modifying the file on disk
        fs.writeFileSync(tempFile, 'modified by CLI agent');

        // Give time for file system watcher and document reload events to propagate
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Follow mode should still be enabled because the change was external
        assert.strictEqual(changeFollower.isEnabled, true, 'Follow mode should remain enabled for external changes to the active editor');
        assert.strictEqual(autoDisableFired, false, 'onDidAutoDisable should NOT have fired for external changes');

        disposable.dispose();
    });

    test('onDidAutoDisable event emitter fires callback', async () => {
        changeFollower.enable();

        let callCount = 0;
        const disposable = changeFollower.onDidAutoDisable(() => {
            callCount++;
        });

        // Create and open a temp file as active editor
        const tempFile = path.join(tempDir, 'test-event-emitter.txt');
        fs.writeFileSync(tempFile, 'initial content');
        const uri = vscode.Uri.file(tempFile);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, { preserveFocus: false });

        // Make a manual edit
        await editor.edit(editBuilder => {
            editBuilder.insert(new vscode.Position(0, 0), 'edit ');
        });

        await new Promise(resolve => setTimeout(resolve, 200));

        // Should have fired exactly once (disable happens on first edit, subsequent edits
        // won't trigger because follow mode is already disabled)
        assert.strictEqual(callCount, 1, 'onDidAutoDisable should fire exactly once');

        disposable.dispose();
    });
});

suite('ChangeFollower Lifecycle Test Suite', () => {
    let changeFollower: ChangeFollower;
    let tempDir: string;
    let uri: vscode.Uri;
    const disposables: vscode.Disposable[] = [];

    setup(() => {
        const configManager = new class extends ConfigurationManager {
            override get highlightDuration(): number {
                return 2000;
            }
        }();
        changeFollower = new ChangeFollower(configManager);
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcf-lifecycle-test-'));
        uri = vscode.Uri.file(path.join(tempDir, 'change.txt'));
        fs.writeFileSync(uri.fsPath, 'changed content');
    });

    teardown(async () => {
        for (const disposable of disposables) {
            disposable.dispose();
        }
        disposables.length = 0;
        changeFollower.dispose();

        const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(
            tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString()
        );
        await vscode.window.tabGroups.close(tabs, true);
        await fs.promises.rm(tempDir, { recursive: true, maxRetries: 5, retryDelay: 100 });
    });

    function showChange(): Promise<void> {
        return changeFollower['showChange']({
            uri,
            ranges: [new vscode.Range(0, 0, 0, 0)],
            timestamp: Date.now()
        });
    }

    test('Should not open a document when already disabled', async () => {
        await showChange();

        assert.strictEqual(vscode.workspace.textDocuments.some(doc => doc.uri.toString() === uri.toString()), false);
    });

    test('Should not show a document when disabled while opening it', async () => {
        changeFollower.enable();
        disposables.push(vscode.workspace.onDidOpenTextDocument(document => {
            if (document.uri.toString() === uri.toString()) {
                changeFollower.disable(true);
            }
        }));

        await showChange();

        assert.strictEqual(changeFollower.isEnabled, false);
        assert.strictEqual(vscode.window.visibleTextEditors.some(editor => editor.document.uri.toString() === uri.toString()), false);
    });

    test('Should not highlight an editor when disabled while showing it', async () => {
        changeFollower.enable();
        disposables.push(vscode.window.onDidChangeVisibleTextEditors(editors => {
            if (editors.some(editor => editor.document.uri.toString() === uri.toString())) {
                changeFollower.disable(true);
            }
        }));

        await showChange();

        assert.strictEqual(changeFollower.isEnabled, false);
        assert.strictEqual(changeFollower['activeHighlights'].size, 0);
    });

    test('Should still show and highlight changes while enabled', async () => {
        changeFollower.enable();

        await showChange();

        assert.ok(vscode.window.visibleTextEditors.some(editor => editor.document.uri.toString() === uri.toString()));
        assert.ok(changeFollower['activeHighlights'].has(uri.toString()));
    });
});
