import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

// 課題 i261114-01 (決定 422-A): 利用者の発言を受けるたびに、タイトルの状態の色を付け替えるよう 1 行で促す UserPromptSubmit フック。
// 共通ルール「セッションのタイトルに状態の色を付ける」の文は残す (423-A)。フックは止めず、促すだけ。
const root = resolve(import.meta.dirname, '..');
const hook = join(root, 'tools/80_ops/claude-hooks/remind-title-color.ts');

function runHook(stdin: string): { status: number | null; context: string } {
	const r = spawnSync('node', [hook], { input: stdin, encoding: 'utf8', timeout: 15000 });
	if (!r.stdout.trim()) return { status: r.status, context: '' };
	const out = JSON.parse(r.stdout);
	assert.equal(out.hookSpecificOutput?.hookEventName, 'UserPromptSubmit');
	return { status: r.status, context: out.hookSpecificOutput?.additionalContext ?? '' };
}

describe('remind-title-color (UserPromptSubmit フック)', () => {
	test('発言を受けたら、色の付け替えを促す文を差し込む', () => {
		const r = runHook(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: '次を進めて' }));
		assert.equal(r.status, 0);
		assert.match(r.context, /set_session_title/);
		assert.match(r.context, /🟢/);
		assert.match(r.context, /🔴/);
		assert.match(r.context, /セッションのタイトルに状態の色を付ける/);
	});

	test('入力が読めなければ、何も出さない', () => {
		const r = runHook('not json');
		assert.equal(r.status, 0);
		assert.equal(r.context, '');
	});

	test('prompt が無ければ、何も出さない', () => {
		assert.equal(runHook(JSON.stringify({ hook_event_name: 'UserPromptSubmit' })).context, '');
	});
});
