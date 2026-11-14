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
function runHook(transcriptPath: string, toolUseId?: string): { denied: boolean; stdout: string; status: number | null } {
	const input = JSON.stringify({ hook_event_name: 'PreToolUse', transcript_path: transcriptPath, tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: toolUseId });
	const r = spawnSync('node', [hook], { input, timeout: 15000, encoding: 'utf8', env: { ...process.env, CLAUDE_ENGLISH_MARK_DIR: join(work, 'marks') } });
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

	// 振り返り r261111-01 の 14-A: ツールの前のフックが動く時点では、同じ応答の文がまだ記録に無い。
	// 1 つ前のツールが通っていれば、そのツールの前に書いた文も読み直す
	test('1 つ前のツールが通っていれば、そのツールの前のテキストも返す', () => {
		const jsonl = [user('始めて'), assistant(english), toolUse(), toolResult(), assistant(japanese)].map((l) => JSON.stringify(l)).join('\n');
		assert.deepEqual(textsSinceLastToolResult(jsonl, 'toolu_now'), [english, japanese]);
	});

	test('1 つ前のツールを止めていれば (結果がエラー)、そのツールの前のテキストは返さない', () => {
		const denied = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true, content: '止めた' }] } };
		const jsonl = [user('始めて'), assistant(english), toolUse(), denied, assistant(japanese)].map((l) => JSON.stringify(l)).join('\n');
		assert.deepEqual(textsSinceLastToolResult(jsonl, 'toolu_now'), [japanese]);
	});

	test('2 つ前のツールより前のテキストは返さない', () => {
		const jsonl = [user('始めて'), assistant(english), toolUse(), toolResult(), toolUse(), toolResult(), assistant(japanese)].map((l) => JSON.stringify(l)).join('\n');
		assert.deepEqual(textsSinceLastToolResult(jsonl, 'toolu_now'), [japanese]);
	});

	test('いま呼ぶツールの呼び出しがログに書かれていても、その前のテキストを返す', () => {
		const jsonl = [user('始めて'), toolUse(), toolResult(), assistant(english), toolUse()].map((l) => JSON.stringify(l)).join('\n');
		assert.deepEqual(textsSinceLastToolResult(jsonl), [english]);
	});

	// 決定 420-A: 前のツールの結果がまだログに書かれていなくても、前のツールの呼び出しより前の文を返す。
	// 前のツールのときに記録に無かった英文を、ここで読む。止めた文を 2 度止めないのは、印で受け持つ (i261031-08)
	test('前のツールの結果が書かれていなくても、前のツールの呼び出しより前のテキストを返す (420-A)', () => {
		const prev = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_prev', name: 'Bash', input: {} }] } };
		const jsonl = [user('始めて'), assistant(english), prev, assistant(japanese)].map((l) => JSON.stringify(l)).join('\n');
		assert.deepEqual(textsSinceLastToolResult(jsonl, 'toolu_now'), [english, japanese]);
	});

	test('いま呼ぶツールの呼び出しでは区切らない', () => {
		const now = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_now', name: 'Bash', input: {} }] } };
		const jsonl = [user('始めて'), assistant(english), now].map((l) => JSON.stringify(l)).join('\n');
		assert.deepEqual(textsSinceLastToolResult(jsonl, 'toolu_now'), [english]);
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

	test('前のツールの結果がまだ書かれていなくても、止めて訳を書いた後のツールは通す (i261031-08)', () => {
		const prev = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_prev', name: 'Bash', input: {} }] } };
		// 前のツールのときに止めた (印が付く)
		assert.equal(runHook(transcript('lagging', [user('始めて'), assistant(english)]), 'toolu_prev').denied, true);
		const r = runHook(transcript('lagging', [user('始めて'), assistant(english), prev, assistant(japanese)]), 'toolu_now');
		assert.equal(r.denied, false);
	});

	// 決定 420-A: #1940 の事象。英文がまだ記録に無いうちに前のツールが通り、その結果も書かれていない
	test('前のツールのときに記録に無かった英文は、次のツールで止める (420-A)', () => {
		const prev = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_prev', name: 'Bash', input: {} }] } };
		const r = runHook(transcript('unseen', [user('始めて'), assistant(japanese), assistant(english), prev]), 'toolu_now');
		assert.equal(r.denied, true);
	});

	test('一度止めた英文では、2 度止めない (420-A)', () => {
		assert.equal(runHook(transcript('once', [user('始めて'), assistant(english)]), 'toolu_a').denied, true);
		assert.equal(runHook(transcript('once', [user('始めて'), assistant(english)]), 'toolu_b').denied, false);
	});

	test('1 つ前のツールの前に書いた英文は、次のツールで止める (r261111-01 の 14-A)', () => {
		const r = runHook(transcript('late-flush', [user('始めて'), assistant(english), toolUse(), toolResult()]), 'toolu_now');
		assert.equal(r.denied, true);
	});

	// 課題 i261031-08 (決定 426): 英文のあとに、その英文を「」で引いた日本語のかたまりがあれば、訳済みとして通す
	test('英文のあとに、その英文を「」で引いた日本語のかたまりがあれば、ツールを通す (426)', () => {
		const r = runHook(transcript('translated', [user('始めて'), assistant(english), assistant(`訳: 「${english}」→「${japanese}」`)]));
		assert.equal(r.denied, false);
	});

	test('英文のあとに日本語のかたまりがあっても、英文を引いていなければ、止める (426)', () => {
		const r = runHook(transcript('not-translated', [user('始めて'), assistant(english), assistant(japanese)]));
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

	// 課題 i261111-04: どの文が英語かを引用して返す
	test('止めるときの理由に、英語だけの文を引用する', () => {
		const r = runHook(transcript('quote', [user('始めて'), assistant(japanese), assistant(english)]));
		const reason = JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason as string;
		assert.ok(reason.includes('「' + english + '」'), reason);
		assert.ok(!reason.includes(japanese), reason);
	});

	test('長い英文は、先頭の 80 字までを引用する', () => {
		const long = 'This sentence is intentionally written to be quite long so that the hook has to cut it short in the reason.';
		const r = runHook(transcript('quote-long', [user('始めて'), assistant(long)]));
		const reason = JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason as string;
		assert.ok(reason.includes('「' + long.slice(0, 80) + '…」'), reason);
	});
});
