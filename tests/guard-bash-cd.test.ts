import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

// 課題 i261109-02: Bash の cd (pushd) を止める PreToolUse フック。
// 共通ルール「シェル実行ルール」で禁じているが、2 回破った (振り返り r261109-01 の 15-A)。
// Bash ツールの cd は、移った先が以降の呼び出しにも残る。
const root = resolve(import.meta.dirname, '..');
const hook = join(root, 'tools/80_ops/claude-hooks/guard-bash-cd.ts');

function run(tool_name: string, command: string): { denied: boolean; reason: string } {
	const input = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input: { command } });
	const r = spawnSync(process.execPath.includes('bun') ? 'node' : process.execPath, [hook], { input, encoding: 'utf8', timeout: 15000 });
	if (!r.stdout.trim()) return { denied: false, reason: '' };
	const out = JSON.parse(r.stdout);
	return { denied: out.hookSpecificOutput?.permissionDecision === 'deny', reason: out.hookSpecificOutput?.permissionDecisionReason ?? '' };
}

describe('止めるもの', () => {
	for (const c of ['cd C:/work/x', 'cd C:/work/x && git status', 'git status; cd ..', 'pushd C:/w', '  cd /tmp', '(cd C:/w && ls)', 'echo a\ncd b']) {
		test(`${JSON.stringify(c)} を止め、絶対パスと git -C を案内する`, () => {
			const r = run('Bash', c);
			assert.equal(r.denied, true);
			assert.match(r.reason, /絶対パス/);
			assert.match(r.reason, /git -C/);
		});
	}
});

describe('通すもの', () => {
	for (const c of [
		'git -C C:/w status',
		'echo "cd x"',
		'git commit -m "題\n\ncd しない" -- a.md',
		'ls C:/w/cdrom',
		'abcd x',
		'cdk deploy',
	]) {
		test(`${JSON.stringify(c)} は通す`, () => assert.equal(run('Bash', c).denied, false));
	}
	test('PowerShell は見ない', () => assert.equal(run('PowerShell', 'cd C:/w').denied, false));
});
