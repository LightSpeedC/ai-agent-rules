import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

// 課題 i261103-01: 作業を止める指示を受けたとき、cron を消すよう思い出させる UserPromptSubmit フック。
// 利用者が止めるよう言っても cron が残り、点検が動き続けた (20261019-file-manager の振り返り 460)。
// 語の判定はサンプルのまま (10-A)。語だけで当たるため、差し込む文で「作業全体を止める指示か」を読ませる。
const root = resolve(import.meta.dirname, '..');
const hook = join(root, 'tools/80_ops/claude-hooks/stop-cron-on-halt.ts');

// フックを実際に node で起動し、差し込まれた文 (無ければ空) を返す
function runHook(stdin: string): string {
	const r = spawnSync(process.execPath.includes('bun') ? 'node' : process.execPath, [hook], { input: stdin, encoding: 'utf8', timeout: 15000 });
	if (!r.stdout.trim()) return '';
	const out = JSON.parse(r.stdout);
	assert.equal(out.hookSpecificOutput?.hookEventName, 'UserPromptSubmit');
	return out.hookSpecificOutput?.additionalContext ?? '';
}

const say = (prompt: string) => runHook(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt }));

describe('止める指示で差し込む', () => {
	test('「止めて」で差し込む', () => {
		const c = say('いったん止めて');
		assert.match(c, /CronList/);
		assert.match(c, /CronDelete/);
	});
	test('「区切りで止めて」で差し込む', () => {
		assert.match(say('この区切りで止めて'), /CronDelete/);
	});
	test('「中断して」で差し込む', () => {
		assert.match(say('作業を中断して'), /CronDelete/);
	});
	test('「ストップ」「止める」でも差し込む', () => {
		assert.match(say('ストップ'), /CronDelete/);
		assert.match(say('今日はここで止める'), /CronDelete/);
	});
	test('差し込む文に、特定のものを止める指示・止めることの説明なら消さないと書いてある', () => {
		const c = say('止めて');
		assert.match(c, /プロセス/);
		assert.match(c, /消さない/);
	});
	test('差し込む文に、再び張るのは利用者が再開を指示してからと書いてある', () => {
		assert.match(say('止めて'), /再開/);
	});
});

describe('差し込まないもの', () => {
	test('「fm を止めてよい」の許可の言い回しでは差し込まない', () => {
		assert.equal(say('fm を止めてよい'), '');
	});
	test('「止めても構わない」では差し込まない', () => {
		assert.equal(say('サービスは止めても構わない'), '');
	});
	test('語の無い発言では差し込まない', () => {
		assert.equal(say('git status'), '');
	});
	test('入力が JSON でなければ何も出さない', () => {
		assert.equal(runHook('壊れた入力'), '');
	});
	test('prompt が無い入力では何も出さない', () => {
		assert.equal(runHook(JSON.stringify({ hook_event_name: 'UserPromptSubmit' })), '');
	});
});
