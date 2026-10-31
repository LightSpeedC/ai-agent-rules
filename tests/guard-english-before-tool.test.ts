import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { textsSinceLastToolResult } from '../tools/80_ops/claude-hooks/japanese-check.ts';

// 課題 i261029-01: ツールを呼ぶ前に、直前の文が英語だけなら止める PreToolUse フック。
// Stop フックは応答を終えた後に見るため、ツールの前に書いた 1 行の英語は、ターンの最後まで見つからなかった。
// 見るのは、直前のツールの結果（無ければ利用者の発言）より後のテキストだけ。
// いま呼ぼうとしているツールの呼び出しが、ログに書かれているかどうかに左右されないため。
const root = resolve(import.meta.dirname, '..');
const hook = join(root, 'tools/80_ops/claude-hooks/guard-english-before-tool.ts');

let work = '';

before(() => {
	mkdirSync(join(root, 'tmp'), { recursive: true });
	work = mkdtempSync(join(root, 'tmp/guard-english-test-'));
});

after(() => {
	rmSync(work, { recursive: true, force: true });
});

function transcript(name: string, lines: unknown[]): string {
	const file = join(work, name + '.jsonl');
	writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
	return file;
}

const user = (text: string) => ({ type: 'user', message: { role: 'user', content: text } });
const assistant = (text: string) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const toolUse = () => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }] } });
const toolResult = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'a.txt' }] } });

const english = 'Checking the waiters and the cron list before continuing with the work.';
const japanese = '待受けと cron を確かめてから、作業を続けます。';

// フックを実際に node で起動し、止めたかどうかを返す
function runHook(transcriptPath: string): { denied: boolean; stdout: string; status: number | null } {
	const input = JSON.stringify({ hook_event_name: 'PreToolUse', transcript_path: transcriptPath, tool_name: 'Bash', tool_input: { command: 'ls' } });
	const r = spawnSync('node', [hook], { input, timeout: 15000, encoding: 'utf8' });
	let denied = false;
	try {
		denied = JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision === 'deny';
	} catch {
		// 何も出さなければ通す
	}
	return { denied, stdout: r.stdout, status: r.status };
}

describe('textsSinceLastToolResult（直前のツールの結果より後のテキスト）', () => {
	test('ツールの結果が無ければ、利用者の発言より後のテキストを返す', () => {
		const jsonl = [user('始めて'), assistant(japanese), assistant(english)].map((l) => JSON.stringify(l)).join('\n');
		assert.deepEqual(textsSinceLastToolResult(jsonl), [japanese, english]);
	});

	test('ツールの結果より前のテキストは返さない', () => {
		const jsonl = [user('始めて'), assistant(english), toolUse(), toolResult(), assistant(japanese)].map((l) => JSON.stringify(l)).join('\n');
		assert.deepEqual(textsSinceLastToolResult(jsonl), [japanese]);
	});

	test('いま呼ぶツールの呼び出しがログに書かれていても、その前のテキストを返す', () => {
		const jsonl = [user('始めて'), toolUse(), toolResult(), assistant(english), toolUse()].map((l) => JSON.stringify(l)).join('\n');
		assert.deepEqual(textsSinceLastToolResult(jsonl), [english]);
	});
});

describe('guard-english-before-tool（PreToolUse フック）', () => {
	test('英語だけの文の後のツールは止める', () => {
		const r = runHook(transcript('english', [user('始めて'), assistant(english)]));
		assert.equal(r.status, 0);
		assert.equal(r.denied, true);
	});

	test('日本語の文の後のツールは通す', () => {
		const r = runHook(transcript('japanese', [user('始めて'), assistant(japanese)]));
		assert.equal(r.status, 0);
		assert.equal(r.denied, false);
	});

	test('止めた後に日本語で書けば、次のツールは通す', () => {
		const denied = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true, content: '止めた' }] } };
		const r = runHook(transcript('rewritten', [user('始めて'), assistant(english), toolUse(), denied, assistant(japanese)]));
		assert.equal(r.denied, false);
	});

	test('発言の番号（#1689）を含む英文の後のツールも止める', () => {
		const r = runHook(transcript('issue-number', [user('始めて'), assistant('Diff matches #1689 and #1690. Committing and pushing per the local rule.')]));
		assert.equal(r.denied, true);
	});

	test('会話ログが読めなければ、通す', () => {
		const r = runHook(join(work, 'missing.jsonl'));
		assert.equal(r.status, 0);
		assert.equal(r.denied, false);
	});

	test('止めるときの理由に、日本語の訳を本文に書くよう案内がある', () => {
		const r = runHook(transcript('reason', [user('始めて'), assistant(english)]));
		const reason = JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason as string;
		assert.match(reason, /日本語/);
	});
});
