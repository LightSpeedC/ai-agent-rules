import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

// 課題 i261109-01: 一括で載せる git add・git commit -a と、パスを名指ししない git commit を止める PreToolUse フック。
// 共通ルール「修正は1点ずつ、確認を重視」で禁じているが、ai-agent-tools で git add -A を使った (#1853)。
// こちらでは、git mv・issue set が先に stage したファイルが、パスを指定しない commit に 2 度混ざった (振り返り r261109-01 の 14-A)。
// git commit -- <path>… はほかに stage されたものを載せないため、commit にもパスの名指しを求める。
const root = resolve(import.meta.dirname, '..');
const hook = join(root, 'tools/80_ops/claude-hooks/guard-git-add-all.ts');

function run(tool_name: string, command: string): { denied: boolean; reason: string } {
	const input = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input: { command } });
	const r = spawnSync(process.execPath.includes('bun') ? 'node' : process.execPath, [hook], { input, encoding: 'utf8', timeout: 15000 });
	if (!r.stdout.trim()) return { denied: false, reason: '' };
	const out = JSON.parse(r.stdout);
	return { denied: out.hookSpecificOutput?.permissionDecision === 'deny', reason: out.hookSpecificOutput?.permissionDecisionReason ?? '' };
}

describe('止めるもの', () => {
	for (const c of ['git add -A', 'git add --all', 'git add .', 'git add -A notes/', 'git add ./', 'git -C C:/w/x add -A']) {
		test(`${c} を止め、名指しを案内する`, () => {
			const r = run('Bash', c);
			assert.equal(r.denied, true);
			assert.match(r.reason, /git add <パス>/);
		});
	}
	for (const c of ['git commit -a -m "x"', 'git commit -am "x"', 'git commit --all -m x']) {
		test(`${c} を止める`, () => assert.equal(run('Bash', c).denied, true));
	}
	test('パスを名指ししない git commit を止め、-- <パス> を案内する', () => {
		const r = run('Bash', 'git commit -m "記録: x"');
		assert.equal(r.denied, true);
		assert.match(r.reason, /-- <パス>/);
	});
	test('&& の後ろの commit も見る', () => assert.equal(run('Bash', 'git add a.md && git commit -m x').denied, true));
	test('PowerShell でも止める', () => assert.equal(run('PowerShell', 'git add -A').denied, true));
	test('-C と -c の後ろでも見る', () => assert.equal(run('Bash', 'git -c core.quotepath=false -C C:/w commit -m x').denied, true));
});

describe('通すもの', () => {
	for (const c of [
		'git add notes/a.md README.html',
		'git commit -m "x" -- notes/a.md',
		'git -C C:/w commit -m "a -- b" -- a.md',
		'git status --short',
		'git diff --cached --name-only',
		'echo "git add -A"',
		'git log --all --oneline',
	]) {
		test(`${c} は通す`, () => assert.equal(run('Bash', c).denied, false));
	}
	// 複数行のメッセージの中の改行で区切ると、後ろの -- <パス> を見失って止めてしまった (2026-11-09)
	test('複数行のメッセージの後ろに -- <パス> がある commit は通す', () => {
		assert.equal(run('Bash', 'git commit -m "題\n\n本文; a && b" -- rules/a.md && git push').denied, false);
	});
	test('Bash・PowerShell 以外は見ない', () => assert.equal(run('Edit', 'git add -A').denied, false));
	test('メッセージの中の -- はパスの名指しと見ない', () => assert.equal(run('Bash', 'git commit -m "a -- b"').denied, true));
});
