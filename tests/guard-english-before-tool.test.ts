import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
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
	const r = spawnSync('node', [hook], { input, timeout: 15000, encoding: 'utf8', env: { ...process.env, CLAUDE_ENGLISH_MARK_DIR: join(work, 'marks'), CLAUDE_ENGLISH_LOG_DIR: join(work, 'denylogs') } });
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
	// 決定 445-A: 前のツールのときに読めなかった英文は、1 度猶予して印を付け、次のツールでまだ訳済みが見えなければ止める
	test('前のツールのときに記録に無かった英文は、1 度猶予し、次のツールで止める (420-A・445-A)', () => {
		const prev = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_prev', name: 'Bash', input: {} }] } };
		const file = transcript('unseen', [user('始めて'), assistant(english), prev]);
		assert.equal(runHook(file, 'toolu_now').denied, false);
		assert.equal(runHook(file, 'toolu_now2').denied, true);
	});

	test('猶予した英文のあとに訳が見えれば、次のツールも通す (445-A)', () => {
		const prev = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_prev', name: 'Bash', input: {} }] } };
		assert.equal(runHook(transcript('grace-then-translated', [user('始めて'), assistant(english), prev]), 'toolu_now').denied, false);
		assert.equal(runHook(transcript('grace-then-translated', [user('始めて'), assistant(english), prev, assistant(japanese)]), 'toolu_now2').denied, false);
	});

	// rules-review の S1: 猶予の印を置けないと、毎回猶予になり止まらなくなる。置けないときは、猶予せず止める
	test('猶予の印を置けなければ、猶予せずに止める (445-A)', () => {
		const markFile = join(work, 'marks-is-a-file');
		writeFileSync(markFile, 'ファイルがフォルダの場所にある');
		const file = transcript('grace-unwritable', [user('始めて'), assistant(english), toolUse(), toolResult()]);
		const input = JSON.stringify({ hook_event_name: 'PreToolUse', transcript_path: file, tool_use_id: 'toolu_now' });
		const r = spawnSync('node', [hook], { input, timeout: 15000, encoding: 'utf8', env: { ...process.env, CLAUDE_ENGLISH_MARK_DIR: markFile, CLAUDE_ENGLISH_LOG_DIR: join(work, 'denylogs') } });
		assert.match(r.stdout, /deny/);
	});

	// rules-review の Q1: previous と parts に同じ英文があれば、猶予せず止める
	test('同じ英文が、前のツールの前と直前の両方にあれば、止める (445-A)', () => {
		const file = transcript('grace-same-both', [user('始めて'), assistant(english), toolUse(), toolResult(), assistant(english)]);
		assert.equal(runHook(file, 'toolu_now').denied, true);
	});

	test('直前 (最後のツールの結果より後) に書いた英文は、猶予せず止める (445-A)', () => {
		assert.equal(runHook(transcript('parts-no-grace', [user('始めて'), toolUse(), toolResult(), assistant(english)]), 'toolu_now').denied, true);
	});

	test('一度止めた英文では、2 度止めない (420-A)', () => {
		assert.equal(runHook(transcript('once', [user('始めて'), assistant(english)]), 'toolu_a').denied, true);
		assert.equal(runHook(transcript('once', [user('始めて'), assistant(english)]), 'toolu_b').denied, false);
	});

	test('1 つ前のツールの前に書いた英文は、1 度猶予し、次のツールで止める (r261111-01 の 14-A・445-A)', () => {
		const file = transcript('late-flush', [user('始めて'), assistant(english), toolUse(), toolResult()]);
		assert.equal(runHook(file, 'toolu_now').denied, false);
		assert.equal(runHook(file, 'toolu_now2').denied, true);
	});

	// 課題 i261031-08 (決定 426・446-A): 英文のあとに、英語だけでないかたまりが 1 つでもあれば、訳済みとして通す。引用は要らない
	test('英文のあとに、その英文を「」で引いた日本語のかたまりがあれば、ツールを通す (426)', () => {
		const r = runHook(transcript('translated', [user('始めて'), assistant(english), assistant(`訳: 「${english}」→「${japanese}」`)]));
		assert.equal(r.denied, false);
	});

	test('英文のあとに日本語のかたまりがあれば、英文を引いていなくても、通す (446-A)', () => {
		const r = runHook(transcript('not-quoted', [user('始めて'), assistant(english), assistant(japanese)]));
		assert.equal(r.denied, false);
	});

	test('英文より前の日本語のかたまりは、訳済みとみなさない (446-A)', () => {
		const r = runHook(transcript('japanese-before', [user('始めて'), assistant(japanese), assistant(english)]));
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

// 決定 441-A (i261031-08): 止める直前に、会話ログの末尾と、読んだ文の経路を、Git 管理外の etc/ へ残す。
// 止まった時点でログに訳が無かったかを、あとで確かめるため。ログを残せなくても、止める動きは変えない。
describe('止めた記録 (441-A)', () => {
	const logDir = () => join(work, 'denylogs');
	const logs = () => (existsSync(logDir()) ? readdirSync(logDir()).filter((f) => f.endsWith('.json')) : []);
	const readLog = (file: string) => JSON.parse(readFileSync(join(logDir(), file), 'utf8'));
	const prevUse = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_prev', name: 'Bash', input: {} }] } };

	beforeEach(() => {
		rmSync(logDir(), { recursive: true, force: true });
	});

	test('止めたら、1 回ごとに 1 ファイルを残す', () => {
		const r = runHook(transcript('log-one', [user('始めて'), assistant(english)]), 'toolu_x1');
		assert.equal(r.denied, true);
		assert.equal(logs().length, 1);
	});

	test('止めなければ、何も残さない', () => {
		runHook(transcript('log-none', [user('始めて'), assistant(japanese)]), 'toolu_x2');
		assert.equal(logs().length, 0);
	});

	test('残す項目: tool_use_id・時刻 (JST)・ログの総行数・どの経路で読んだ文か・止めた英文・ログの末尾', () => {
		runHook(transcript('log-fields', [user('始めて'), assistant(english)]), 'toolu_fields');
		const log = readLog(logs()[0]);
		assert.equal(log.tool_use_id, 'toolu_fields');
		assert.match(log.time_jst, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+09:00$/);
		assert.equal(log.total_lines, 2);
		assert.deepEqual(log.texts.map((t: { route: string }) => t.route), ['parts']);
		assert.equal(log.texts[0].text, english);
		assert.deepEqual(log.denied, [english]);
		assert.equal(log.tail.length, 2);
	});

	test('会話ログの末尾は 20 行までにする', () => {
		const many = Array.from({ length: 30 }, (_, i) => user('発言 ' + i));
		runHook(transcript('log-tail', [...many, assistant(english)]), 'toolu_tail');
		const log = readLog(logs()[0]);
		assert.equal(log.total_lines, 31);
		assert.equal(log.tail.length, 20);
		assert.ok(log.tail[19].blocks[0].text.includes('Checking the waiters'));
	});

	// rules-review の S1: 画像や大きな結果を含む 1 行が、そのまま記録に入ると、1 回で数十 MB になりうる
	test('末尾の行のテキストは、4000 字までに切る。切ったら省いた字数を添える', () => {
		const big = 'あ'.repeat(6000);
		runHook(transcript('log-big', [user('始めて'), assistant(big), assistant(english)]), 'toolu_big');
		const log = readLog(logs()[0]);
		const text = log.tail[1].blocks[0].text as string;
		assert.ok(text.startsWith('あ'.repeat(4000)));
		assert.ok(text.length < 4100, String(text.length));
		assert.match(text, /2000 字省略/);
		assert.ok(log.tail[2].blocks[0].text.includes('Checking the waiters'));
	});

	// rules-review の Q1: このフックは全プロジェクトで動く。cwd・sessionId・結果の中身などは、記録に入れない
	test('末尾の行には、役割とブロックの種類・テキストだけを残し、cwd や結果の中身は入れない', () => {
		const withMeta = { type: 'assistant', cwd: 'D:/dummy/secret', sessionId: 'sess-secret', message: { role: 'assistant', content: [{ type: 'text', text: english }] } };
		const result = { type: 'user', cwd: 'D:/dummy/secret', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'SECRET-RESULT-BODY' }] } };
		runHook(transcript('log-meta', [user('始めて'), result, withMeta]), 'toolu_meta');
		const raw = readFileSync(join(logDir(), logs()[0]), 'utf8');
		assert.ok(!raw.includes('D:/dummy'), raw);
		assert.ok(!raw.includes('sess-secret'), raw);
		assert.ok(!raw.includes('SECRET-RESULT-BODY'), raw);
		const log = JSON.parse(raw);
		assert.deepEqual(log.tail[1].blocks, [{ type: 'tool_result', tool_use_id: 'toolu_1' }]);
		assert.equal(log.tail[2].role, 'assistant');
	});

	// 445-A: pending・previous の英文は 1 度猶予するので、2 回目のツールで止まったときに残る
	test('前のツールの呼び出しより前の文は、pending として残す', () => {
		const file = transcript('log-pending', [user('始めて'), assistant(english), prevUse]);
		assert.equal(runHook(file, 'toolu_now').denied, false);
		// 猶予した回も、kind: grace で 1 件残す
		assert.equal(logs().length, 1);
		assert.equal(readLog(logs()[0]).kind, 'grace');
		assert.equal(runHook(file, 'toolu_now2').denied, true);
		assert.equal(logs().length, 2);
		const log = logs().map(readLog).find((l) => l.kind === 'deny');
		assert.deepEqual(log.texts.map((t: { route: string }) => t.route), ['pending']);
	});

	test('前のツールが通っていれば、そのツールの前の文は previous として残す', () => {
		const file = transcript('log-previous', [user('始めて'), assistant(english), toolUse(), toolResult()]);
		assert.equal(runHook(file, 'toolu_now').denied, false);
		assert.equal(runHook(file, 'toolu_now2').denied, true);
		const log = logs().map(readLog).find((l) => l.kind === 'deny');
		assert.deepEqual(log.texts.map((t: { route: string }) => t.route), ['previous']);
	});

	test('止めた記録の kind は deny', () => {
		runHook(transcript('log-kind', [user('始めて'), assistant(english)]), 'toolu_kind');
		assert.equal(readLog(logs()[0]).kind, 'deny');
	});

	test('残すファイルは、新しい 50 件までにする', () => {
		mkdirSync(logDir(), { recursive: true });
		for (let i = 0; i < 55; i++) writeFileSync(join(logDir(), `2026-01-01T00-00-00-${String(i).padStart(3, '0')}-old.json`), '{}');
		runHook(transcript('log-cap', [user('始めて'), assistant(english)]), 'toolu_cap');
		const files = logs();
		assert.equal(files.length, 50);
		assert.ok(files.some((f) => f.includes('toolu_cap')), '新しい記録が消えている');
		assert.ok(!files.some((f) => f.includes('-000-old')), '古い記録が残っている');
	});

	test('記録の置き場に書けなくても、止める動きは変えない', () => {
		mkdirSync(work, { recursive: true });
		writeFileSync(logDir(), 'ファイルがフォルダの場所にある');
		const r = runHook(transcript('log-unwritable', [user('始めて'), assistant(english)]), 'toolu_unwritable');
		assert.equal(r.status, 0);
		assert.equal(r.denied, true);
		rmSync(logDir(), { force: true });
	});
});
