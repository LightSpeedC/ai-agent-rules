import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { join, resolve } from 'node:path';

// 課題 i261121-01: 引継ぎ*.md を消す・移す・上書きする操作を、復唱が会話の記録 (JSONL) に無いまま行うと、PreToolUse で止めるフック。
// 20260824-ai-pc-public の依頼 (#2073)。決定 448-A (シェルの操作だけ)・449-A (会話ログ全体)・450-A (全見出し)・451-B (3 回止めたら 4 回目は通す)。
// 設計レビュー (rules-review、2026-11-21) の指摘を取り入れた: コマンド全体で見る (S1)・行ごとに正規化して見出しで始まるか (S2)・足りない見出しを理由文に出す (S3)・古い復唱は数えない (P1)
const root = resolve(import.meta.dirname, '..');
const hook = join(root, 'tools/80_ops/claude-hooks/guard-handoff-delete.ts');

let work = '';
let seq = 0;

before(() => {
	mkdirSync(join(root, 'tmp'), { recursive: true });
	work = mkdtempSync(join(root, 'tmp/guard-handoff-test-'));
});

after(() => {
	rmSync(work, { recursive: true, force: true });
});

const HANDOFF = '# 引継ぎ (2026-11-21 08:00 JST)\n\n## 進行中の作業\n\n本文\n\n## 返事待ち\n\n- なし\n';
const HEADINGS = ['# 引継ぎ (2026-11-21 08:00 JST)', '## 進行中の作業', '## 返事待ち'];

// テストごとに、新しいフォルダと状態の置き場を作る
function fresh(files: Record<string, string> = { '引継ぎ.md': HANDOFF }): { dir: string; state: string } {
	const dir = join(work, `d${++seq}`);
	mkdirSync(dir, { recursive: true });
	for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
	return { dir, state: join(dir, '.state') };
}

type Entry = { role: 'assistant' | 'user'; blocks: unknown[]; ts?: string };
const future = () => new Date(Date.now() + 60000).toISOString();
const text = (s: string, ts = future()): Entry => ({ role: 'assistant', blocks: [{ type: 'text', text: s }], ts });
const userText = (s: string): Entry => ({ role: 'user', blocks: [{ type: 'text', text: s }], ts: future() });
const toolUse = (command: string): Entry => ({ role: 'assistant', blocks: [{ type: 'tool_use', id: `t${++seq}`, name: 'Bash', input: { command } }], ts: future() });
const toolResult = (s: string): Entry => ({ role: 'user', blocks: [{ type: 'tool_result', tool_use_id: 'x', content: s }], ts: future() });

function transcript(dir: string, entries: Entry[], name = 'session.jsonl'): string {
	const file = join(dir, name);
	const lines = entries.map((e) => JSON.stringify({ type: e.role, timestamp: e.ts, message: { role: e.role, content: e.blocks } }));
	writeFileSync(file, lines.join('\n') + '\n');
	return file;
}

type Run = { denied: boolean; reason: string; message: string };

function runHook(o: { command: string; transcript?: string; cwd?: string; state: string; toolName?: string }): Run {
	const input = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: o.toolName ?? 'Bash', tool_input: { command: o.command }, transcript_path: o.transcript, cwd: o.cwd });
	const r = spawnSync('node', [hook], { input, timeout: 15000, encoding: 'utf8', env: { ...process.env, CLAUDE_HANDOFF_GUARD_DIR: o.state } });
	try {
		const out = JSON.parse(r.stdout);
		return { denied: out.hookSpecificOutput?.permissionDecision === 'deny', reason: out.hookSpecificOutput?.permissionDecisionReason ?? '', message: out.systemMessage ?? '' };
	} catch {
		return { denied: false, reason: '', message: '' };
	}
}

// 復唱なしの会話ログで、コマンドを流す
function noRecap(command: string, files?: Record<string, string>, toolName?: string): Run {
	const { dir, state } = fresh(files);
	return runHook({ command, transcript: transcript(dir, [userText('始めて'), text('読みました')]), cwd: dir, state, toolName });
}

describe('対象にする書き方 (復唱が無ければ止める)', () => {
	const cases: [string, string][] = [
		['Remove-Item 位置引数', 'Remove-Item 引継ぎ.md'],
		['Remove-Item -Path 引用符', 'Remove-Item -Path "引継ぎ.md" -Force'],
		['Remove-Item -LiteralPath', "Remove-Item -LiteralPath '引継ぎ.md'"],
		['別名 ri', 'ri 引継ぎ.md'],
		['rm', 'rm 引継ぎ.md'],
		['del', 'del 引継ぎ.md'],
		['erase', 'erase 引継ぎ.md'],
		['cmd /c 経由', 'cmd /c "del 引継ぎ.md"'],
		['psh -c 経由', 'psh -c "Remove-Item 引継ぎ.md"'],
		['powershell -Command 経由', 'powershell -Command "Remove-Item 引継ぎ.md"'],
		['if の中', 'if (Test-Path 引継ぎ.md) { Remove-Item 引継ぎ.md }'],
		['パイプ (ワイルドカード)', 'Get-ChildItem 引継ぎ*.md | Remove-Item'],
		['git rm', 'git rm 引継ぎ.md'],
		['Move-Item の移動元', 'Move-Item 引継ぎ.md old.md'],
		['mv の移動元', 'mv 引継ぎ.md old.md'],
		['git mv の移動元', 'git mv 引継ぎ.md old.md'],
		['ren', 'ren 引継ぎ.md old.md'],
		['> による上書き', 'echo x > 引継ぎ.md'],
		['Set-Content', 'Set-Content 引継ぎ.md "x"'],
		['Out-File', '"x" | Out-File 引継ぎ.md'],
		['tee', 'echo x | tee 引継ぎ.md'],
		['Clear-Content', 'Clear-Content 引継ぎ.md'],
	];
	for (const [name, command] of cases) {
		test(`${name}: ${command}`, () => {
			const r = noRecap(command);
			assert.equal(r.denied, true, r.reason);
		});
	}

	test('PowerShell のツールからも止める', () => {
		assert.equal(noRecap('Remove-Item 引継ぎ.md', undefined, 'PowerShell').denied, true);
	});

	test('移動先がすでにある引継ぎ*.md のときも止める (上書き)', () => {
		const r = noRecap('mv new.md 引継ぎ.md', { '引継ぎ.md': HANDOFF, 'new.md': 'x' });
		assert.equal(r.denied, true);
	});
});

describe('対象にしない (通す)', () => {
	test('引継ぎ以外のファイルの削除・移動', () => {
		assert.equal(noRecap('Remove-Item 引継ぎ-メモ.txt', { '引継ぎ-メモ.txt': 'x', '引継ぎ.md': HANDOFF }).denied, false);
		assert.equal(noRecap('Remove-Item handoff.md', { 'handoff.md': 'x', '引継ぎ.md': HANDOFF }).denied, false);
		assert.equal(noRecap('mv a.txt b.txt').denied, false);
	});

	test('読むだけの操作・追記は止めない', () => {
		for (const c of ['Get-Content 引継ぎ.md', 'cat 引継ぎ.md', 'Test-Path 引継ぎ.md', 'echo x >> 引継ぎ.md', 'Add-Content 引継ぎ.md "x"', 'echo x | tee -a 引継ぎ.md', '"x" | Out-File -Append 引継ぎ.md', 'git status']) {
			assert.equal(noRecap(c).denied, false, c);
		}
	});

	test('コミットメッセージの中の記述は、対象にしない', () => {
		assert.equal(noRecap('git commit -m "引継ぎ.md を rm した"').denied, false);
	});

	test('ファイルが無ければ、止めない', () => {
		assert.equal(noRecap('Remove-Item 引継ぎ.md', {}).denied, false);
	});

	test('移動先が無い (新しく作る) mv は、止めない', () => {
		assert.equal(noRecap('mv a.txt 引継ぎ.md', { 'a.txt': 'x' }).denied, false);
	});

	test('フォルダごと消す操作・パスが変数だけの書き方は、リテラルが見えないので対象外', () => {
		assert.equal(noRecap('rm -rf sub').denied, false);
		assert.equal(noRecap('$f = "a"; Remove-Item (Join-Path $PWD $f)').denied, false);
	});

	// レビュー (rules-review、2026-11-21) の S1: 引継ぎ を含むフォルダ名・名前の途中は、引継ぎ*.md ではない (T1)
	test('フォルダ名に引継ぎを含むパス・名前が引継ぎで始まらないファイルは、対象外', () => {
		const files = { '引継ぎ.md': HANDOFF };
		const { dir, state } = fresh(files);
		mkdirSync(join(dir, '引継ぎ-手順'), { recursive: true });
		writeFileSync(join(dir, '引継ぎ-手順', 'readme.md'), '# 手順\n\n## 節\n');
		writeFileSync(join(dir, '旧引継ぎ.md'), '# 旧\n\n## 旧の節\n');
		const t = transcript(dir, [userText('始めて')]);
		for (const c of ['rm 引継ぎ-手順/readme.md', 'rm 旧引継ぎ.md', 'rm notes/引継ぎ-手順/readme.md']) {
			assert.equal(runHook({ command: c, transcript: t, cwd: dir, state }).denied, false, c);
		}
	});

	// S3: 読むだけの操作・文章・書き込み先が別の写しは、止めない (T3)
	test('読んで別のファイルへ写す操作・パスの途中の語・文章の中の語は、止めない', () => {
		for (const c of [
			'Get-Content 引継ぎ.md | Out-File x.txt',
			'cat 引継ぎ.md | tee out.txt',
			'Get-Content 引継ぎ.md | Set-Content copy.md',
			'cat docs/del/引継ぎ.md',
			'Get-Content ./move/引継ぎ.md',
			'aichat say "引継ぎ.md を move した"',
			'issue new --text "rm 引継ぎ.md の件"',
			'gh issue comment 1 --body "引継ぎ.md を rm した"',
		]) {
			assert.equal(noRecap(c).denied, false, c);
		}
	});

	test('コミットメッセージを -F とヒアドキュメントで渡しても、本文の中の記述は対象にしない (T3)', () => {
		assert.equal(noRecap('git commit -F - <<EOF\nrm 引継ぎ.md を直した\nEOF').denied, false);
	});

	// S4: 拡張子なしのワイルドカード (T5)
	test('拡張子なしのワイルドカードも、止める', () => {
		assert.equal(noRecap('Remove-Item 引継ぎ*').denied, true);
		assert.equal(noRecap('rm 引継ぎ.*').denied, true);
		assert.equal(noRecap('del 引継ぎ?.md', { '引継ぎ1.md': HANDOFF }).denied, true);
	});

	test('git -C <フォルダ> rm や xargs rm も、止める', () => {
		assert.equal(noRecap('git -C "W:/proj" rm 引継ぎ.md').denied, true);
		assert.equal(noRecap('ls 引継ぎ*.md | xargs rm').denied, true);
		assert.equal(noRecap('find . -name "引継ぎ*.md" -exec rm {} \\;').denied, true);
	});

	// T4: 対象でないコマンドと、復唱が通った回は、状態の置き場を作らない
	test('対象でないコマンドと、復唱が通った回は、状態の置き場を作らない (T4)', () => {
		const { dir, state } = fresh();
		const t = transcript(dir, [userText('始めて'), text(HEADINGS.join('\n\n'))]);
		runHook({ command: 'git status', transcript: t, cwd: dir, state });
		runHook({ command: 'rm 引継ぎ.md', transcript: t, cwd: dir, state });
		assert.equal(existsSync(state), false);
	});
});

describe('止めない側に倒す条件', () => {
	test('見出しが 0 件 (コードブロックの # だけ・#2073 だけ) なら通す', () => {
		assert.equal(noRecap('rm 引継ぎ.md', { '引継ぎ.md': '```\n# コメント\n```\n' }).denied, false);
		assert.equal(noRecap('rm 引継ぎ.md', { '引継ぎ.md': '#2073 の件\n本文\n' }).denied, false);
		assert.equal(noRecap('rm 引継ぎ.md', { '引継ぎ.md': '本文だけ\n' }).denied, false);
	});

	test('会話ログが無い・読めない・パスが無いときは通す', () => {
		const { dir, state } = fresh();
		assert.equal(runHook({ command: 'rm 引継ぎ.md', cwd: dir, state }).denied, false);
		assert.equal(runHook({ command: 'rm 引継ぎ.md', transcript: join(dir, 'none.jsonl'), cwd: dir, state }).denied, false);
	});

	test('cwd が無く、パスが相対なら判定できないので通す。絶対パスなら見る', () => {
		const { dir, state } = fresh();
		const t = transcript(dir, [userText('始めて')]);
		assert.equal(runHook({ command: 'rm 引継ぎ.md', transcript: t, state }).denied, false);
		assert.equal(runHook({ command: `rm "${join(dir, '引継ぎ.md').replace(/\\/g, '/')}"`, transcript: t, state }).denied, true);
	});

	test('標準入力が壊れていても通す', () => {
		const r = spawnSync('node', [hook], { input: 'not json', timeout: 15000, encoding: 'utf8' });
		assert.equal(r.status, 0);
		assert.equal(r.stdout.trim(), '');
	});
});

describe('復唱の判定', () => {
	const recap = HEADINGS.join('\n\n') + '\n';

	function withRecap(entries: Entry[], command = 'rm 引継ぎ.md', files?: Record<string, string>): Run {
		const { dir, state } = fresh(files);
		return runHook({ command, transcript: transcript(dir, [userText('始めて'), ...entries]), cwd: dir, state });
	}

	test('全見出しが応答の本文にあれば通す', () => {
		assert.equal(withRecap([text(recap)]).denied, false);
	});

	test('1 つでも欠ければ止め、足りない見出しを理由文に書く', () => {
		const r = withRecap([text('# 引継ぎ (2026-11-21 08:00 JST)\n\n## 進行中の作業\n')]);
		assert.equal(r.denied, true);
		assert.match(r.reason, /返事待ち/);
		assert.doesNotMatch(r.reason, /進行中の作業/);
	});

	test('復唱がツールの入力だけ・ツールの結果だけなら、止める', () => {
		assert.equal(withRecap([toolUse(`echo "${recap}"`)]).denied, true);
		assert.equal(withRecap([toolResult(recap)]).denied, true);
	});

	test('見出しの段違い・強調・全角半角・引用・コードブロックの中でも、通す', () => {
		const variants = [
			'### 引継ぎ (2026-11-21 08:00 JST)\n\n### 進行中の作業\n\n### 返事待ち\n',
			'**引継ぎ (2026-11-21 08:00 JST)**\n\n**進行中の作業**\n\n**返事待ち**\n',
			'> # 引継ぎ (2026-11-21 08:00 JST)\n> ## 進行中の作業\n> ## 返事待ち\n',
			'```\n# 引継ぎ (2026-11-21 08:00 JST)\n## 進行中の作業\n## 返事待ち\n```\n',
			'# 引継ぎ （２０２６-11-21 08:00 JST）\n## 進行中の作業\n## 返事待ち\n',
		];
		for (const v of variants) assert.equal(withRecap([text(v)]).denied, false, v);
	});

	test('BOM と CRLF のファイルでも、通す', () => {
		const files = { '引継ぎ.md': '﻿' + HANDOFF.replace(/\n/g, '\r\n') };
		assert.equal(withRecap([text(recap)], 'rm 引継ぎ.md', files).denied, false);
		assert.equal(withRecap([], 'rm 引継ぎ.md', files).denied, true);
	});

	test('見出しの語が普通の文の途中に入っているだけなら、復唱とみなさない', () => {
		assert.equal(withRecap([text('今は返事待ちです。進行中の作業もあります。引継ぎ (2026-11-21 08:00 JST) を読みました')]).denied, true);
	});

	test('ファイルの更新より前の復唱は、数えない', () => {
		const old = new Date(Date.now() - 3600e3).toISOString();
		assert.equal(withRecap([text(recap, old)]).denied, true);
	});

	test('時刻の無い行は、数える (止めない側)', () => {
		const e = text(recap);
		delete e.ts;
		assert.equal(withRecap([e]).denied, false);
	});

	test('複数の引継ぎ*.md は、ファイルごとに全見出しを求め、理由文にファイルごとの不足を出す', () => {
		const files = { '引継ぎ.md': HANDOFF, '引継ぎ-子.md': '# 子の引継ぎ\n\n## 子の作業\n' };
		const r = withRecap([text(recap)], 'Remove-Item 引継ぎ*.md', files);
		assert.equal(r.denied, true);
		assert.match(r.reason, /引継ぎ-子\.md/);
		assert.match(r.reason, /子の作業/);
		assert.equal(withRecap([text(recap + '# 子の引継ぎ\n## 子の作業\n')], 'Remove-Item 引継ぎ*.md', files).denied, false);
	});

	test('足りない見出しの引用は、3 件までにする', () => {
		const many = '# 表題\n' + [1, 2, 3, 4, 5].map((n) => `## 節${n}`).join('\n') + '\n';
		const r = withRecap([], 'rm 引継ぎ.md', { '引継ぎ.md': many });
		assert.equal(r.denied, true);
		assert.match(r.reason, /節2/);
		assert.doesNotMatch(r.reason, /節5/);
	});
});

describe('抜け出せること', () => {
	test('止めたあと、復唱が会話ログに入れば通る (2 段)', () => {
		const { dir, state } = fresh();
		const first = transcript(dir, [userText('始めて'), text('読みました')]);
		assert.equal(runHook({ command: 'rm 引継ぎ.md', transcript: first, cwd: dir, state }).denied, true);
		const second = transcript(dir, [userText('始めて'), text('読みました'), text(HEADINGS.join('\n\n')), toolUse('rm 引継ぎ.md')]);
		assert.equal(runHook({ command: 'rm 引継ぎ.md', transcript: second, cwd: dir, state }).denied, false);
	});

	test('止め続けても、3 回止めたあとの 4 回目は通し、警告を出す (451-B)', () => {
		const { dir, state } = fresh();
		const t = transcript(dir, [userText('始めて'), text('読みました')]);
		for (let i = 1; i <= 3; i++) assert.equal(runHook({ command: 'rm 引継ぎ.md', transcript: t, cwd: dir, state }).denied, true, `${i} 回目`);
		const fourth = runHook({ command: 'rm 引継ぎ.md', transcript: t, cwd: dir, state });
		assert.equal(fourth.denied, false);
		assert.match(fourth.message, /復唱/);
	});

	test('止めた回数は、同じセッションの中でも、ファイルごとに数える (T7)', () => {
		const { dir, state } = fresh({ '引継ぎ.md': HANDOFF, '引継ぎ-子.md': '# 子の引継ぎ\n\n## 子の作業\n' });
		const t = transcript(dir, [userText('始めて')]);
		for (let i = 0; i < 3; i++) runHook({ command: 'rm 引継ぎ.md', transcript: t, cwd: dir, state });
		assert.equal(runHook({ command: 'rm 引継ぎ.md', transcript: t, cwd: dir, state }).denied, false);
		assert.equal(runHook({ command: 'rm 引継ぎ-子.md', transcript: t, cwd: dir, state }).denied, true);
	});

	test('復唱が通ったあとに、ファイルを書き換えたら、また止める。回数も数え直す (T2)', () => {
		const { dir, state } = fresh();
		const recapT = transcript(dir, [userText('始めて'), text(HEADINGS.join('\n\n'))]);
		runHook({ command: 'rm 引継ぎ.md', transcript: transcript(dir, [userText('始めて')], 'other.jsonl'), cwd: dir, state });
		assert.equal(runHook({ command: 'rm 引継ぎ.md', transcript: recapT, cwd: dir, state }).denied, false);
		// 書き換えて、更新時刻を進める。前の復唱は、古くなる
		writeFileSync(join(dir, '引継ぎ.md'), HANDOFF + '\n## 追加\n');
		const later = new Date(Date.now() + 120000);
		utimesSync(join(dir, '引継ぎ.md'), later, later);
		assert.equal(runHook({ command: 'rm 引継ぎ.md', transcript: recapT, cwd: dir, state }).denied, true);
	});

	test('上限に達したあとにファイルを書き換えたら、また止める (T2)', () => {
		const { dir, state } = fresh();
		const t = transcript(dir, [userText('始めて')]);
		for (let i = 0; i < 4; i++) runHook({ command: 'rm 引継ぎ.md', transcript: t, cwd: dir, state });
		writeFileSync(join(dir, '引継ぎ.md'), HANDOFF + '\n## 追加\n');
		const later = new Date(Date.now() + 120000);
		utimesSync(join(dir, '引継ぎ.md'), later, later);
		assert.equal(runHook({ command: 'rm 引継ぎ.md', transcript: t, cwd: dir, state }).denied, true);
	});

	test('状態の置き場を書けないときは、止めずに通す (T6)', () => {
		const { dir } = fresh();
		writeFileSync(join(dir, 'afile'), 'x');
		const t = transcript(dir, [userText('始めて')]);
		assert.equal(runHook({ command: 'rm 引継ぎ.md', transcript: t, cwd: dir, state: join(dir, 'afile', 'sub') }).denied, false);
	});

	test('警告の記録 (.allowed.log) を書けなくても、警告は出す (T6)', () => {
		const { dir, state } = fresh();
		const t = transcript(dir, [userText('始めて')]);
		mkdirSync(join(state, 'session.jsonl.allowed.log'), { recursive: true });
		for (let i = 0; i < 3; i++) runHook({ command: 'rm 引継ぎ.md', transcript: t, cwd: dir, state });
		const fourth = runHook({ command: 'rm 引継ぎ.md', transcript: t, cwd: dir, state });
		assert.equal(fourth.denied, false);
		assert.match(fourth.message, /復唱/);
	});

	test('止めたときの理由文に、復唱のしかたと、呼び直せば通ることを書く', () => {
		const r = noRecap('rm 引継ぎ.md');
		assert.match(r.reason, /復唱がまだ記録にありません/);
		assert.match(r.reason, /呼び直せば通ります/);
	});

	test('古いファイルの更新時刻を使う: 更新時刻を過去にすれば、その後の復唱で通る', () => {
		const { dir, state } = fresh();
		const past = new Date(Date.now() - 7200e3);
		utimesSync(join(dir, '引継ぎ.md'), past, past);
		const old = new Date(Date.now() - 3600e3).toISOString();
		const t = transcript(dir, [userText('始めて'), text(HEADINGS.join('\n\n'), old)]);
		assert.equal(runHook({ command: 'rm 引継ぎ.md', transcript: t, cwd: dir, state }).denied, false);
	});
});
