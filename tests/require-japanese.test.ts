import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isEnglishOnly, lastAssistantText, lastTurnTexts } from '../tools/80_ops/claude-hooks/japanese-check.ts';

// 課題 p261021-01: 英語だけの応答を日本語に書き直させる Stop フック。
// 判定の関数は japanese-check.ts に分けてあり、ここでは直接確かめる。フック全体は、実際に node で起動して確かめる。
const root = resolve(import.meta.dirname, '..');
const hook = join(root, 'tools/80_ops/claude-hooks/require-japanese.ts');

let work = '';

before(() => {
	mkdirSync(join(root, 'tmp'), { recursive: true });
	work = mkdtempSync(join(root, 'tmp/japanese-test-'));
});

after(() => {
	rmSync(work, { recursive: true, force: true });
});

// ファイルの会話ログから、最後の応答を取り出す（読めなければ空文字）
function lastOf(file: string): string {
	try {
		return lastAssistantText(readFileSync(file, 'utf8'));
	} catch {
		return '';
	}
}

// 会話ログ（JSONL）を、実際の形（message.role・content の配列）で書く
function transcript(name: string, lines: unknown[]): string {
	const file = join(work, name + '.jsonl');
	writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
	return file;
}

const user = (text: string) => ({ type: 'user', message: { role: 'user', content: text } });
const assistant = (text: string) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const toolUse = () => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }] } });
const toolResult = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'a.txt' }] } });

describe('isEnglishOnly（英語だけかどうかの判定）', () => {
	test('日本語だけの応答は、英語のみとみなさない', () => {
		assert.equal(isEnglishOnly('これは日本語だけの応答で、英字は一つも含まない。長さも十分にある。'), false);
	});

	test('英字が 20 字以上で、かな・カタカナ・漢字が 1 字も無ければ、英語のみとみなす', () => {
		assert.equal(isEnglishOnly('This response is written entirely in English without any Japanese.'), true);
	});

	test('英字が 20 字未満なら、英語のみとみなさない（短い固有名詞など）', () => {
		assert.equal(isEnglishOnly('OK, done.'), false);
	});

	test('日本語が 1 字でも混ざれば、英語のみとみなさない', () => {
		assert.equal(isEnglishOnly('This response is mostly English but ends with a Japanese word 完了。'), false);
	});

	test('列挙された記号（" ` [] {} < > = + * % # / @）を含めばコードとみなし、英語のみとみなさない', () => {
		assert.equal(isEnglishOnly('This sentence explains the result but also has a path: C/work/file'), false);
		assert.equal(isEnglishOnly('This sentence explains the result and also has a value a=b in it'), false);
		assert.equal(isEnglishOnly('This sentence explains the result and also has a tag <div> in it'), false);
	});

	// コロンとセミコロンは英文でも使う。どちらか一方だけでは、コードとはみなさない
	test('コロンやセミコロンだけを含む英文は、コードとはみなさず英語のみとみなす', () => {
		assert.equal(isEnglishOnly('Note: this sentence is plain English; with punctuation and no code at all.'), true);
	});

	test('バッククォート（`）を含めばコードとみなし、英語のみとみなさない', () => {
		assert.equal(isEnglishOnly('Run `git status` to see the changes in this repository now.'), false);
	});

	test('‘ , . - ( ) だけなら、コードとはみなさず英語のみとみなす', () => {
		assert.equal(isEnglishOnly('This is a plain sentence, with commas. And a dash - and (parentheses) only.'), true);
	});

	test('空の文は、英語のみとみなさない', () => {
		assert.equal(isEnglishOnly(''), false);
	});
});

describe('lastAssistantText（最後の応答のテキスト）', () => {
	test('最後のユーザ発言の後の、アシスタントのテキストだけを集める', () => {
		const file = transcript('last1', [assistant('古い応答'), user('次の質問'), assistant('最後の応答')]);
		assert.equal(lastOf(file), '最後の応答');
	});

	test('ツールの結果は区切りにならず、同じ応答の続きとして扱う', () => {
		const file = transcript('last2', [user('質問'), assistant('前半'), toolUse(), toolResult(), assistant('後半')]);
		assert.equal(lastOf(file), '前半後半');
	});

	// 応答は、テキストのかたまりごとに別の行として記録される。かたまりごとに判定できるよう、区切りを残して取り出す
	test('テキストのかたまりを、別々に取り出す（途中の英語を、日本語のかたまりに混ぜて隠さない）', () => {
		const file = transcript('last3', [user('質問'), assistant('日本語の説明です。'), assistant('This is a plain English sentence in the middle of the reply.'), assistant('最後は日本語。')]);
		assert.deepEqual(lastTurnTexts(readFileSync(file, 'utf8')), ['日本語の説明です。', 'This is a plain English sentence in the middle of the reply.', '最後は日本語。']);
	});

	test('会話ログが無ければ空文字', () => {
		assert.equal(lastOf(join(work, 'no-such.jsonl')), '');
	});
});

describe('require-japanese（フック全体）', () => {
	const runHook = (input: unknown) => spawnSync('node', [hook], { input: JSON.stringify(input), encoding: 'utf8', timeout: 15000 });

	// 途中のかたまりが英語だけなら、応答全体に日本語があっても、書き直させる
	test('日本語の応答の途中に英語だけのかたまりがあれば、decision: block を返す', () => {
		const file = transcript('hook5', [user('質問'), assistant('日本語の説明です。'), assistant('This is a plain English sentence in the middle of the reply.'), assistant('最後は日本語。')]);
		const r = runHook({ hook_event_name: 'Stop', transcript_path: file, stop_hook_active: false });
		assert.equal(r.status, 0, r.stderr);
		assert.equal(JSON.parse(r.stdout).decision, 'block');
	});

	test('英語だけの応答は、日本語で書き直すように decision: block を返す', () => {
		const file = transcript('hook1', [user('質問'), assistant('This response is written entirely in English without any Japanese.')]);
		const r = runHook({ hook_event_name: 'Stop', transcript_path: file, stop_hook_active: false });
		assert.equal(r.status, 0, r.stderr);
		const out = JSON.parse(r.stdout);
		assert.equal(out.decision, 'block');
		assert.match(out.reason, /日本語で書いて/);
	});

	test('日本語の応答では、何も出さない', () => {
		const file = transcript('hook2', [user('質問'), assistant('これは日本語の応答で、十分な長さがある。英字 API が混ざっても問題ない。')]);
		const r = runHook({ hook_event_name: 'Stop', transcript_path: file, stop_hook_active: false });
		assert.equal(r.status, 0);
		assert.equal(r.stdout, '');
	});

	// 書き直させた後の Stop で、また書き直させると止まらなくなる。2 回目は止めずに ❌ を出す
	test('stop_hook_active が true なら、もう書き直させず、❌ を表示する', () => {
		const file = transcript('hook3', [user('質問'), assistant('This response is written entirely in English without any Japanese.')]);
		const r = runHook({ hook_event_name: 'Stop', transcript_path: file, stop_hook_active: true });
		assert.equal(r.status, 0);
		const out = JSON.parse(r.stdout);
		assert.equal(out.decision, undefined);
		assert.match(out.systemMessage, /^❌/);
	});

	test('コードブロックだけの応答は、書き直させない', () => {
		const file = transcript('hook4', [user('質問'), assistant('```\nnpm test --watch=false --reporter=spec\n```')]);
		const r = runHook({ hook_event_name: 'Stop', transcript_path: file, stop_hook_active: false });
		assert.equal(r.stdout, '');
	});

	test('transcript_path が無い・読めないときは、何もせず終了コード 0', () => {
		const r = runHook({ hook_event_name: 'Stop', stop_hook_active: false });
		assert.equal(r.status, 0);
		assert.equal(r.stdout, '');
	});
});
