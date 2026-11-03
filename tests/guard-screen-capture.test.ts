import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

// 課題 i261101-02: 画面の範囲を撮る呼び出しを止める PreToolUse フック。
// 20261019-file-manager で、確かめの撮影に画面の範囲を写し、ほかの窓が会話の記録に残った (#1732)。
// 止める語は 3 つ (7-A)。見るのはコマンド・コマンドに出た ps1 と cs の中身・スクリプトへの Write と Edit (6-C・9-A)。
// 窓 1 つを撮るときにも使う BitBlt・PrintWindow・PrimaryScreen は止めない。
const root = resolve(import.meta.dirname, '..');
const hook = join(root, 'tools/80_ops/claude-hooks/guard-screen-capture.ts');

let work = '';

before(() => {
	mkdirSync(join(root, 'tmp'), { recursive: true });
	work = mkdtempSync(join(root, 'tmp/guard-screen-test-'));
});

after(() => {
	rmSync(work, { recursive: true, force: true });
});

// フックを実際に node で起動し、止めたかどうかを返す
function runHook(stdin: string): { denied: boolean; reason: string } {
	const r = spawnSync(process.execPath.includes('bun') ? 'node' : process.execPath, [hook], { input: stdin, encoding: 'utf8', timeout: 15000 });
	if (!r.stdout.trim()) return { denied: false, reason: '' };
	const out = JSON.parse(r.stdout);
	return { denied: out.hookSpecificOutput?.permissionDecision === 'deny', reason: out.hookSpecificOutput?.permissionDecisionReason ?? '' };
}

const call = (tool_name: string, tool_input: Record<string, unknown>) => runHook(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input }));

describe('止める語', () => {
	test('PowerShell の CopyFromScreen を止める', () => {
		const r = call('PowerShell', { command: '$g.CopyFromScreen(0, 0, 0, 0, $s)' });
		assert.equal(r.denied, true);
		assert.match(r.reason, /CopyFromScreen/);
	});
	test('GetDC(0) と GetDC([IntPtr]::Zero) を止める', () => {
		assert.equal(call('PowerShell', { command: '$dc = [W]::GetDC(0)' }).denied, true);
		assert.equal(call('PowerShell', { command: '$dc = [W]::GetDC( [IntPtr]::Zero )' }).denied, true);
	});
	test('GetWindowDC(GetDesktopWindow()) を止める', () => {
		assert.equal(call('PowerShell', { command: '$dc = [W]::GetWindowDC([W]::GetDesktopWindow())' }).denied, true);
	});
	test('Bash から psh -c で包んでも止める', () => {
		assert.equal(call('Bash', { command: 'psh -c "$g.copyfromscreen(0,0,0,0,$s)"' }).denied, true);
	});
});

describe('通すもの', () => {
	test('窓 1 つを撮る GetWindowDC(hwnd) と BitBlt は通す', () => {
		assert.equal(call('PowerShell', { command: '$dc = [W]::GetWindowDC($hwnd); [W]::BitBlt($m, 0, 0, $w, $h, $dc, 0, 0, 0xCC0020)' }).denied, false);
	});
	test('語の無いコマンドは通す', () => {
		assert.equal(call('Bash', { command: 'git status' }).denied, false);
	});
	test('資料 (html・md) への Write は、語があっても通す', () => {
		assert.equal(call('Write', { file_path: join(work, 'a.html'), content: 'CopyFromScreen を使わない' }).denied, false);
		assert.equal(call('Edit', { file_path: join(work, 'a.md'), old_string: 'x', new_string: 'GetDC(0)' }).denied, false);
	});
	test('入力が JSON でなければ通す', () => {
		assert.equal(runHook('壊れた入力').denied, false);
	});
	test('コマンドに出た ps1 が無ければ、そのファイルを飛ばして通す', () => {
		assert.equal(call('PowerShell', { command: `psh "${join(work, 'none.ps1')}"` }).denied, false);
	});
});

describe('スクリプトの中身', () => {
	test('コマンドに出た ps1 の中に CopyFromScreen があれば止める', () => {
		const ps1 = join(work, 'shot.ps1');
		writeFileSync(ps1, '$g.CopyFromScreen(0, 0, 0, 0, $s)\n');
		assert.equal(call('Bash', { command: `psh "${ps1.replaceAll('\\', '/')}"` }).denied, true);
	});
	test('ps1 への Write で、中身に語があれば止める', () => {
		assert.equal(call('Write', { file_path: join(work, 'b.ps1'), content: '$g.CopyFromScreen(0,0,0,0,$s)' }).denied, true);
	});
	test('cs への Edit で、新しい文字列に語があれば止める', () => {
		assert.equal(call('Edit', { file_path: join(work, 'c.cs'), old_string: 'x', new_string: 'GetDC(IntPtr.Zero)' }).denied, true);
	});
	test('psm1 への Write も止める', () => {
		assert.equal(call('Write', { file_path: join(work, 'd.psm1'), content: 'GetDC(0)' }).denied, true);
	});
});
