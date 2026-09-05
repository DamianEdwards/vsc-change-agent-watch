import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ChangeFollower } from '../../changeFollower';
import { ConfigurationManager } from '../../configuration';

class TestConfigurationManager extends ConfigurationManager {
    autoClose = true;

    override get autoCloseOnSwitch(): boolean {
        return this.autoClose;
    }

    override get disableOnManualEdit(): boolean {
        return false;
    }

    override get highlightDuration(): number {
        return 0;
    }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>(complete => { resolve = complete; });
    return { promise, resolve };
}

suite('Follow Tab Auto-Close Test Suite', function () {
    this.timeout(15000);

    let config: TestConfigurationManager;
    let follower: ChangeFollower;
    let tempDir: string;
    let subscriptions: vscode.Disposable[];

    function allTabs(): vscode.Tab[] {
        return vscode.window.tabGroups.all.flatMap(group => [...group.tabs]);
    }

    function tabsFor(uri: vscode.Uri): vscode.Tab[] {
        return allTabs().filter(tab => tab.input instanceof vscode.TabInputText
            && tab.input.uri.toString() === uri.toString());
    }

    function createFile(name: string): vscode.Uri {
        const filePath = path.join(tempDir, name);
        fs.writeFileSync(filePath, 'initial content\n');
        return vscode.Uri.file(filePath);
    }

    async function openFile(uri: vscode.Uri, options: vscode.TextDocumentShowOptions = {}): Promise<vscode.TextEditor> {
        const document = await vscode.workspace.openTextDocument(uri);
        return vscode.window.showTextDocument(document, { preview: false, ...options });
    }

    async function followFile(uri: vscode.Uri): Promise<void> {
        // Exercise the real navigation pipeline without waiting for filesystem/debounce timing.
        follower['queueChange'](uri, [new vscode.Range(0, 0, 0, 0)]);
        follower['processChangesDebouncer']?.cancel();
        await follower['processChanges']();
    }

    function setAutoClose(enabled: boolean): void {
        config.autoClose = enabled;
        follower.onConfigurationChanged();
    }

    setup(() => {
        config = new TestConfigurationManager();
        follower = new ChangeFollower(config);
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcf-auto-close-'));
        subscriptions = [];
    });

    teardown(async () => {
        for (const subscription of subscriptions) {
            subscription.dispose();
        }
        follower.dispose();
        await follower['navigationQueue'];
        for (const document of vscode.workspace.textDocuments) {
            if (document.uri.fsPath.startsWith(tempDir + path.sep) && document.isDirty) {
                assert.ok(await document.save());
            }
        }
        const testTabs = allTabs().filter(tab => tab.input instanceof vscode.TabInputText
            && tab.input.uri.fsPath.startsWith(tempDir + path.sep));
        assert.ok(await vscode.window.tabGroups.close(testTabs, true));
        await fs.promises.rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    test('Setting is opt-in in both the manifest and configuration manager', () => {
        const setting = vscode.workspace.getConfiguration('fileChangeFollower').inspect<boolean>('autoCloseOnSwitch');
        assert.strictEqual(setting?.defaultValue, false);
        assert.strictEqual(new ConfigurationManager().autoCloseOnSwitch, false);
    });

    test('Disabled setting preserves the existing tab accumulation behavior', async () => {
        setAutoClose(false);
        follower.enable();
        const first = createFile('first.txt');
        const second = createFile('second.txt');
        await followFile(first);
        await followFile(second);
        assert.strictEqual(tabsFor(first).length, 1);
        assert.strictEqual(tabsFor(second).length, 1);
    });

    test('Closes the previous follow tab but keeps the current and final tab', async () => {
        follower.enable();
        const first = createFile('first.txt');
        const second = createFile('second.txt');
        await followFile(first);
        const firstTab = tabsFor(first)[0];
        assert.ok(firstTab);
        await followFile(first);
        assert.ok(allTabs().includes(firstTab), 'Repeated changes must reuse the current tab');
        await followFile(second);
        assert.strictEqual(tabsFor(first).length, 0);
        assert.strictEqual(tabsFor(second).length, 1);
        follower.disable();
        assert.strictEqual(tabsFor(second).length, 1, 'Stopping follow mode must leave the last tab open');
    });

    test('Protects pre-existing background and preview tabs across groups', async () => {
        await openFile(createFile('background.txt'), { viewColumn: vscode.ViewColumn.One });
        await openFile(createFile('foreground.txt'), { viewColumn: vscode.ViewColumn.One });
        const preview = createFile('preview.txt');
        await openFile(preview, { viewColumn: vscode.ViewColumn.Two, preview: true });
        const originalTabs = allTabs();
        assert.ok(tabsFor(preview)[0].isPreview);
        follower.enable();
        const first = createFile('first.txt');
        await followFile(first);
        await followFile(createFile('second.txt'));
        assert.strictEqual(tabsFor(first).length, 0);
        for (const tab of originalTabs) {
            assert.ok(allTabs().includes(tab), `Pre-existing tab ${tab.label} must remain open`);
        }
    });

    test('Can follow a previously auto-closed file again without accumulating tabs', async () => {
        follower.enable();
        const first = createFile('first.txt');
        const second = createFile('second.txt');
        await followFile(first);
        await followFile(second);
        await followFile(first);
        assert.strictEqual(tabsFor(first).length, 1);
        assert.strictEqual(tabsFor(second).length, 0);
        await followFile(second);
        assert.strictEqual(tabsFor(first).length, 0);
        assert.strictEqual(tabsFor(second).length, 1);
    });

    test('Protects tabs opened manually after follow mode starts, even when followed later', async () => {
        follower.enable();
        const first = createFile('first.txt');
        const manual = createFile('manual.txt');
        await followFile(first);
        await openFile(manual);
        const manualTab = tabsFor(manual)[0];
        await followFile(manual);
        assert.strictEqual(tabsFor(first).length, 0, 'Switching to an existing tab should still clean up follow tabs');
        await followFile(createFile('second.txt'));
        assert.ok(allTabs().includes(manualTab));
    });

    test('Protects a user-created split of a followed file', async () => {
        follower.enable();
        const first = createFile('first.txt');
        await followFile(first);
        const originalTab = tabsFor(first)[0];
        await openFile(first, { viewColumn: vscode.ViewColumn.Beside });
        const splitTab = tabsFor(first).find(tab => tab !== originalTab);
        assert.ok(splitTab);
        await followFile(createFile('second.txt'));
        assert.ok(!allTabs().includes(originalTab));
        assert.ok(allTabs().includes(splitTab));
        assert.strictEqual(tabsFor(first).length, 1);
    });

    test('Protects a follow tab moved by the user to another group', async () => {
        follower.enable();
        const first = createFile('first.txt');
        await followFile(first);
        const originalGroup = tabsFor(first)[0].group;
        await openFile(first);
        await vscode.commands.executeCommand('moveActiveEditor', { to: 'right', by: 'group' });
        assert.notStrictEqual(tabsFor(first)[0].group, originalGroup);
        await followFile(createFile('second.txt'));
        await followFile(createFile('third.txt'));
        assert.strictEqual(tabsFor(first).length, 1);
    });

    test('Protects dirty follow tabs, including after they are saved', async () => {
        follower.enable();
        const first = createFile('first.txt');
        await followFile(first);
        const editor = await openFile(first);
        await editor.edit(edit => edit.insert(new vscode.Position(0, 0), 'manual edit '));
        assert.ok(editor.document.isDirty);
        await followFile(createFile('second.txt'));
        assert.strictEqual(tabsFor(first).length, 1);
        assert.ok(await editor.document.save());
        await followFile(createFile('third.txt'));
        assert.strictEqual(tabsFor(first).length, 1);
    });

    test('Protects explicitly pinned follow tabs, including after they are unpinned', async () => {
        follower.enable();
        const first = createFile('first.txt');
        await followFile(first);
        await openFile(first);
        await vscode.commands.executeCommand('workbench.action.pinEditor');
        assert.ok(tabsFor(first)[0].isPinned);
        await followFile(createFile('second.txt'));
        assert.strictEqual(tabsFor(first).length, 1);
        await openFile(first);
        await vscode.commands.executeCommand('workbench.action.unpinEditor');
        assert.ok(!tabsFor(first)[0].isPinned);
        await followFile(createFile('third.txt'));
        assert.strictEqual(tabsFor(first).length, 1);
    });

    test('Does not reclaim ownership when the user closes and reopens a follow tab', async () => {
        follower.enable();
        const first = createFile('first.txt');
        await followFile(first);
        assert.ok(await vscode.window.tabGroups.close(tabsFor(first), true));
        await openFile(first);
        await followFile(first);
        await followFile(createFile('second.txt'));
        assert.strictEqual(tabsFor(first).length, 1);
    });

    test('Re-enabling follow mode protects tabs left by the previous session', async () => {
        follower.enable();
        const first = createFile('first.txt');
        const second = createFile('second.txt');
        await followFile(first);
        follower.disable();
        follower.enable();
        await followFile(second);
        await followFile(createFile('third.txt'));
        assert.strictEqual(tabsFor(first).length, 1);
        assert.strictEqual(tabsFor(second).length, 0);
    });

    test('Toggling the setting clears ownership without closing existing tabs', async () => {
        follower.enable();
        const first = createFile('first.txt');
        const second = createFile('second.txt');
        const third = createFile('third.txt');
        await followFile(first);
        setAutoClose(false);
        await followFile(second);
        setAutoClose(true);
        await followFile(third);
        await followFile(createFile('fourth.txt'));
        assert.strictEqual(tabsFor(first).length, 1);
        assert.strictEqual(tabsFor(second).length, 1);
        assert.strictEqual(tabsFor(third).length, 0);
    });

    test('Failed navigation preserves the last follow tab and allows later navigation', async () => {
        follower.enable();
        const first = createFile('first.txt');
        await followFile(first);
        await followFile(vscode.Uri.file(path.join(tempDir, 'missing.txt')));
        assert.strictEqual(tabsFor(first).length, 1);
        await followFile(createFile('second.txt'));
        assert.strictEqual(tabsFor(first).length, 0);
    });

    test('Refreshing configuration retains pending debounced changes', async () => {
        follower.enable();
        const pending = createFile('pending.txt');
        const opened = deferred();
        subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(event => {
            if (event.opened.some(tab => tab.input instanceof vscode.TabInputText
                && tab.input.uri.toString() === pending.toString())) {
                opened.resolve();
            }
        }));
        follower['queueChange'](pending, [new vscode.Range(0, 0, 0, 0)]);
        follower.onConfigurationChanged();
        await opened.promise;
        await follower['navigationQueue'];
        assert.strictEqual(tabsFor(pending).length, 1);
    });

    test('Serializes overlapping navigation and cleanup', async () => {
        follower.enable();
        const first = createFile('first.txt');
        const second = createFile('second.txt');
        const third = createFile('third.txt');
        const started = deferred();
        const resume = deferred();
        const showChange = follower['showChange'].bind(follower);
        const navigationOrder: string[] = [];
        follower['showChange'] = async (change, session) => {
            navigationOrder.push(change.uri.toString());
            if (change.uri.toString() === first.toString()) {
                started.resolve();
                await resume.promise;
            }
            await showChange(change, session);
        };

        const firstNavigation = followFile(first);
        try {
            await started.promise;
            const secondNavigation = followFile(second);
            const thirdNavigation = followFile(third);
            await Promise.resolve();
            assert.deepStrictEqual(navigationOrder, [first.toString()]);
            resume.resolve();
            await Promise.all([firstNavigation, secondNavigation, thirdNavigation]);
            assert.deepStrictEqual(navigationOrder, [first, second, third].map(uri => uri.toString()));
            assert.strictEqual(tabsFor(first).length, 0);
            assert.strictEqual(tabsFor(second).length, 0);
            assert.strictEqual(tabsFor(third).length, 1);
        } finally {
            resume.resolve();
        }
    });

    test('Disabling and re-enabling invalidates already queued navigation', async () => {
        follower.enable();
        const first = createFile('first.txt');
        const second = createFile('second.txt');
        const third = createFile('third.txt');
        const firstNavigation = followFile(first);
        const secondNavigation = followFile(second);
        follower.disable();
        follower.enable();
        await Promise.all([firstNavigation, secondNavigation, followFile(third)]);
        assert.strictEqual(tabsFor(first).length, 0);
        assert.strictEqual(tabsFor(second).length, 0);
        assert.strictEqual(tabsFor(third).length, 1);
    });

    test('Does not show a loaded document after its follow session has ended', async () => {
        follower.enable();
        const first = createFile('first.txt');
        const loading = createFile('loading.txt');
        await followFile(first);
        let interrupted = false;
        subscriptions.push(vscode.workspace.onDidOpenTextDocument(document => {
            if (document.uri.toString() === loading.toString()) {
                interrupted = true;
                follower.disable();
                follower.enable();
            }
        }));
        await followFile(loading);
        assert.ok(interrupted);
        await followFile(createFile('third.txt'));
        assert.strictEqual(tabsFor(first).length, 1);
        assert.strictEqual(tabsFor(loading).length, 0);
    });

    test('Does not adopt or clean up tabs when the session changes during display', async () => {
        follower.enable();
        const first = createFile('first.txt');
        const opening = createFile('opening.txt');
        await followFile(first);
        let interrupted = false;
        subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(event => {
            if (event.opened.some(tab => tab.input instanceof vscode.TabInputText
                && tab.input.uri.toString() === opening.toString())) {
                interrupted = true;
                follower.disable();
                follower.enable();
            }
        }));
        await followFile(opening);
        assert.ok(interrupted);
        await followFile(createFile('third.txt'));
        assert.strictEqual(tabsFor(first).length, 1);
        assert.strictEqual(tabsFor(opening).length, 1);
    });

    test('Does not adopt tabs across a setting toggle during display', async () => {
        follower.enable();
        const first = createFile('first.txt');
        const opening = createFile('opening.txt');
        await followFile(first);
        let interrupted = false;
        subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(event => {
            if (event.opened.some(tab => tab.input instanceof vscode.TabInputText
                && tab.input.uri.toString() === opening.toString())) {
                interrupted = true;
                setAutoClose(false);
                setAutoClose(true);
            }
        }));
        await followFile(opening);
        assert.ok(interrupted);
        await followFile(createFile('third.txt'));
        assert.strictEqual(tabsFor(first).length, 1);
        assert.strictEqual(tabsFor(opening).length, 1);
    });
});
