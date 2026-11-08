import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

// 課題 i261108-01: 作業記録 (_config/ の HTML) に UTC の時刻を書く Edit・Write を止める PreToolUse フック。
// 20260917-oracle-cloud で、UTC の出力を JST に直さずに作業記録へ書いた。ルールの更新 (#1823) だけでは止まらなかった。
// 条件は 2-A: パスに /_config/ を含む .html。新しく書く分 (Write の content・Edit の new_string) の行に UTC があり、同じ行に JST が無ければ止める。
const root = resolve(import.meta.dirname, '..');
const hook = join(root, 'tools/80_ops/claude-hooks/guard-utc-in-record.ts');

function runHook(stdin: string): { denied: boolean; reason: string } {
	const r = spawnSync(process.execPath.includes('bun') ? 'node' : process.execPath, [hook], { input: stdin, encoding: 'utf8', timeout: 15000 });
	if (!r.stdout.trim()) return { denied: false, reason: '' };
	const out = JSON.parse(r.stdout);
	return { denied: out.hookSpecificOutput?.permissionDecision === 'deny', reason: out.hookSpecificOutput?.permissionDecisionReason ?? '' };
}

const call = (tool_name: string, tool_input: Record<string, unknown>) => runHook(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input }));
const rec = 'X:/proj/_config/2026-11-08-作業.html';

describe('止めるもの', () => {
	test('Write の中身に JST の無い UTC の行があれば止める', () => {
		const r = call('Write', { file_path: rec, content: '<p>開始</p>\n<td>2026-11-08 01:41 UTC</td>\n' });
		assert.equal(r.denied, true);
		assert.match(r.reason, /JST/);
	});
	test('Edit の new_string に (UTC) があれば止める', () => {
		assert.equal(call('Edit', { file_path: rec, old_string: 'x', new_string: '<th>時刻 (UTC)</th>' }).denied, true);
	});
	test('date -u の出力の形も止める', () => {
		assert.equal(call('Write', { file_path: rec, content: 'Sat Nov  8 01:41:03 UTC 2026' }).denied, true);
	});
	test('Windows の区切りのパスでも止める', () => {
		assert.equal(call('Write', { file_path: 'X:\\proj\\_config\\a.html', content: '01:41 UTC' }).denied, true);
	});
});

describe('通すもの', () => {
	test('同じ行に JST を添えてあれば通す', () => {
		assert.equal(call('Write', { file_path: rec, content: '01:41 UTC (JST 10:41)' }).denied, false);
	});
	test('JST だけの行は通す', () => {
		assert.equal(call('Edit', { file_path: rec, old_string: 'x', new_string: '2026-11-08 10:41 JST' }).denied, false);
	});
	test('old_string にだけ UTC があっても通す', () => {
		assert.equal(call('Edit', { file_path: rec, old_string: '01:41 UTC', new_string: '10:41 JST' }).denied, false);
	});
	test('_config/ の外の HTML は通す', () => {
		assert.equal(call('Write', { file_path: 'X:/proj/notes/a.html', content: '01:41 UTC' }).denied, false);
	});
	test('_config/ の中でも HTML でなければ通す', () => {
		assert.equal(call('Write', { file_path: 'X:/proj/_config/a.md', content: '01:41 UTC' }).denied, false);
	});
	test('Edit・Write 以外は通す', () => {
		assert.equal(call('Bash', { command: 'date -u' }).denied, false);
	});
	test('入力が JSON でなければ通す', () => {
		assert.equal(runHook('壊れた入力').denied, false);
	});
});
