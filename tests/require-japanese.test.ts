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

	// 課題 i261031-01（#1709）: 記号や日本語の字が 1 つあるだけで丸ごと外すと、Markdown で書いた英文の多くがすり抜けた。
	// コードの部分を除いてから、日本語の字の数と英語の語の数を比べる（3-A）。
	test('日本語の語が 1 つ混ざっただけの英文は、英語のみとみなす', () => {
		assert.equal(isEnglishOnly('This response is mostly English but ends with a Japanese word 完了。'), true);
		assert.equal(isEnglishOnly('I added the issue to 課題 and replied to the requester with the result of the investigation.'), true);
	});

	test('太字（**）を含む英文は、英語のみとみなす', () => {
		assert.equal(isEnglishOnly('The fix is in place. **All 125 tests pass** and the hook is ready for registration.'), true);
	});

	test('パス・URL・コードスパン・記号を含む英文は、それらを除いて判定し、英語のみとみなす', () => {
		assert.equal(isEnglishOnly('This sentence explains the result but also has a path: C/work/file'), true);
		assert.equal(isEnglishOnly('I updated the file at tools/80_ops/claude-hooks and all of the tests now pass on both runtimes.'), true);
		assert.equal(isEnglishOnly('See https://example.com/docs/page for the details of the change that was made.'), true);
		assert.equal(isEnglishOnly('Run `git status` to see the changes in this repository now.'), true);
		assert.equal(isEnglishOnly('This sentence explains the result and also has a value a=b in it'), true);
	});

	// 課題 i261029-01 の 2-A: 発言の番号（#1689）は英文にも普通に出る
	test('発言の番号（#1689）を含む英文は、英語のみとみなす', () => {
		assert.equal(isEnglishOnly('Diff matches #1689 and #1690. Committing and pushing per the local rule.'), true);
	});

	test('見出し・箇条書き・引用・表の記法を含む英文は、英語のみとみなす', () => {
		assert.equal(isEnglishOnly('## Result\n\n- The tests pass on both runtimes\n> quoted line here\n| a | b |'), true);
	});

	test('識別子やコードスパンの多い日本語の応答は、英語のみとみなさない', () => {
		assert.equal(isEnglishOnly('`japanese-check.ts` の `isEnglishOnly` を直し、`guard-english-before-tool.ts` を足した。node と bun で全件が通った。'), false);
		assert.equal(isEnglishOnly('PreToolUse の hook で permissionDecision を deny にして、Stop hook の decision block と揃えた。'), false);
	});

	test('英語のエラー文を 1 行引いた日本語の応答は、英語のみとみなさない', () => {
		assert.equal(isEnglishOnly('push が失敗しました。出たメッセージは次のとおりです。\nfatal: could not read Username for github\n認証を設定し直してから、もう一度実行します。'), false);
	});

	test('URL の多い日本語の応答は、英語のみとみなさない', () => {
		assert.equal(isEnglishOnly('出典は https://github.com/oven-sh/bun/issues/43660 と https://github.com/microsoft/terminal/issues/9174 です。'), false);
	});

	// 10/31 に会話ログへ流して見つけた誤判定: diff の中のフェンスで、開きと閉じの組がずれ、日本語の部分まで除いていた
	test('中にフェンスを含む diff を貼った日本語の応答は、英語のみとみなさない', () => {
		const text = [
			'コミットの差分です。',
			'',
			'```diff',
			'diff --git a/rules/coding-rules.md b/rules/coding-rules.md',
			'+  ```csharp',
			'+  var utf8 = new UTF8Encoding(false);',
			'+  if (Console.IsOutputRedirected) Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), utf8));',
			'+  ```',
			' ```powershell',
			'```',
			'',
			'push はまだしていません。共通ルールの追随として、次の点検でも確かめます。',
		].join('\n');
		assert.equal(isEnglishOnly(text), false);
	});

	test('コードブロックだけのかたまりは、英語のみとみなさない', () => {
		assert.equal(isEnglishOnly('```powershell\nGet-ChildItem -Path . -Recurse | Where-Object { $_.Length -gt 1000 }\n```'), false);
	});

	// コロンとセミコロンは英文でも使う。どちらか一方だけでは、コードとはみなさない
	test('コロンやセミコロンだけを含む英文は、コードとはみなさず英語のみとみなす', () => {
		assert.equal(isEnglishOnly('Note: this sentence is plain English; with punctuation and no code at all.'), true);
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
