import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, utimesSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// フック本体は tools/80_ops/claude-hooks/ にある。テストは本番の ~/.claude や Vault に触れず、tmp/ の下だけで動かす
const root = resolve(import.meta.dirname, '..');
const hooksDir = join(root, 'tools/80_ops/claude-hooks');
const copyHook = join(hooksDir, 'copy-session-jsonl.ts');
const memoryHook = join(hooksDir, 'load-obsidian-memory.ts');

let work = '';

before(() => {
	mkdirSync(join(root, 'tmp'), { recursive: true });
	work = mkdtempSync(join(root, 'tmp/hooks-test-'));
});

after(() => {
	rmSync(work, { recursive: true, force: true });
});

// 呼び出しごとに、他のテストと干渉しない作業フォルダを作る。
// project を付けると、その中に .git を置いてプロジェクトの直下に見せる（写し先は、cwd から上へたどった .git のある所になるため。
// 付けないと、tmp/ の上にあるこのリポジトリの直下まで上ってしまう）
function makeDir(name: string, project = false): string {
	const dir = join(work, name);
	mkdirSync(dir, { recursive: true });
	if (project) mkdirSync(join(dir, '.git'), { recursive: true });
	return dir;
}

// 表示の先頭は「絵文字 + 月/日 時:分」（例: ✅10/04 00:50 …）。日時は動くので、文言を比べるときは日時を外す
function unstamp(message: string): string {
	return message.replace(/^(\S)\d{2}\/\d{2} \d{2}:\d{2} /, '$1 ');
}

function run(script: string, input: string, env: Record<string, string | undefined> = {}) {
	const mergedEnv: Record<string, string | undefined> = { ...process.env, ...env };
	for (const key of Object.keys(mergedEnv)) {
		if (mergedEnv[key] === undefined) delete mergedEnv[key];
	}
	// timeout は固まったことに気づく唯一の手段（同期 API は待ちを止めるため）
	const r = spawnSync('node', [script], { input, env: mergedEnv as NodeJS.ProcessEnv, timeout: 15000, encoding: 'utf8' });
	return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('copy-session-jsonl', () => {
	test('transcript_path のあるフォルダの jsonl を、cwd の etc/history/jsonl へすべてコピーする', () => {
		const src = makeDir('copy1-src');
		const cwd = makeDir('copy1-cwd', true);
		writeFileSync(join(src, 'a.jsonl'), 'AAA\n');
		writeFileSync(join(src, 'b.jsonl'), 'BBB\n');
		writeFileSync(join(src, 'memo.txt'), 'jsonl 以外はコピーしない');
		const r = run(copyHook, JSON.stringify({ transcript_path: join(src, 'a.jsonl'), cwd }));
		assert.equal(r.status, 0, r.stderr);
		const dest = join(cwd, 'etc/history/jsonl');
		assert.deepEqual(readdirSync(dest).sort(), ['a.jsonl', 'b.jsonl']);
		assert.equal(readFileSync(join(dest, 'b.jsonl'), 'utf8'), 'BBB\n');
	});

	// Stop フックは応答ごとに走るため、変わっていないファイルを毎回コピーしない
	test('サイズと更新日時が同じファイルは再コピーしない', () => {
		const src = makeDir('copy2-src');
		const cwd = makeDir('copy2-cwd', true);
		writeFileSync(join(src, 'a.jsonl'), 'AAA\n');
		const input = JSON.stringify({ transcript_path: join(src, 'a.jsonl'), cwd });
		assert.equal(run(copyHook, input).status, 0);
		const dst = join(cwd, 'etc/history/jsonl/a.jsonl');
		// コピー先を同じ長さの別の中身にし、更新日時だけ元に揃える。コピーされれば元の中身に戻る
		writeFileSync(dst, 'ZZZ\n');
		const mtime = statSync(join(src, 'a.jsonl')).mtime;
		utimesSync(dst, mtime, mtime);
		assert.equal(run(copyHook, input).status, 0);
		assert.equal(readFileSync(dst, 'utf8'), 'ZZZ\n');
	});

	test('元が更新されたら上書きする', () => {
		const src = makeDir('copy3-src');
		const cwd = makeDir('copy3-cwd', true);
		writeFileSync(join(src, 'a.jsonl'), 'AAA\n');
		const input = JSON.stringify({ transcript_path: join(src, 'a.jsonl'), cwd });
		assert.equal(run(copyHook, input).status, 0);
		writeFileSync(join(src, 'a.jsonl'), 'AAA\nBBB\n');
		assert.equal(run(copyHook, input).status, 0);
		assert.equal(readFileSync(join(cwd, 'etc/history/jsonl/a.jsonl'), 'utf8'), 'AAA\nBBB\n');
	});

	test('コピーしたファイルの更新日時は元に揃う（次回のスキップ判定に使うため）', () => {
		const src = makeDir('copy4-src');
		const cwd = makeDir('copy4-cwd', true);
		writeFileSync(join(src, 'a.jsonl'), 'AAA\n');
		const old = new Date('2026-01-02T03:04:05.000Z');
		utimesSync(join(src, 'a.jsonl'), old, old);
		run(copyHook, JSON.stringify({ transcript_path: join(src, 'a.jsonl'), cwd }));
		assert.equal(statSync(join(cwd, 'etc/history/jsonl/a.jsonl')).mtime.getTime(), old.getTime());
	});

	test('transcript_path が実在しなければ、何もせず正常終了する', () => {
		const cwd = makeDir('copy5-cwd', true);
		const r = run(copyHook, JSON.stringify({ transcript_path: join(work, 'no-such/x.jsonl'), cwd }));
		assert.equal(r.status, 0);
		assert.equal(existsSync(join(cwd, 'etc')), false);
	});

	test('cwd が無ければ、何もせず正常終了する', () => {
		const src = makeDir('copy6-src');
		writeFileSync(join(src, 'a.jsonl'), 'AAA\n');
		const r = run(copyHook, JSON.stringify({ transcript_path: join(src, 'a.jsonl') }), { CLAUDE_PROJECT_DIR: undefined });
		assert.equal(r.status, 0);
	});
});

// 課題 i261008-01: cwd はセッションがその時点で居るフォルダで、cd すると変わる。写し先を cd に左右されないプロジェクトの直下にする
describe('copy-session-jsonl の写し先（cd に左右されない）', () => {
	const prepare = (name: string) => {
		const src = makeDir(name + '-src');
		writeFileSync(join(src, 'a.jsonl'), 'AAA\n');
		const project = makeDir(name + '-project', true);
		const sub = join(project, 'notes/samples');
		mkdirSync(sub, { recursive: true });
		return { src, project, sub };
	};

	test('環境変数 CLAUDE_PROJECT_DIR があれば、cwd ではなく、そこの etc/history/jsonl へ写す', () => {
		const { src, sub } = prepare('dest1');
		const other = makeDir('dest1-other', true);
		const r = run(copyHook, JSON.stringify({ transcript_path: join(src, 'a.jsonl'), cwd: sub }), { CLAUDE_PROJECT_DIR: other });
		assert.equal(r.status, 0, r.stderr);
		assert.deepEqual(readdirSync(join(other, 'etc/history/jsonl')), ['a.jsonl']);
		assert.equal(existsSync(join(sub, 'etc')), false, 'cd した先には作らない');
	});

	test('環境変数が無ければ、cwd から上へたどって .git のあるフォルダ（プロジェクトの直下）へ写す', () => {
		const { src, project, sub } = prepare('dest2');
		const r = run(copyHook, JSON.stringify({ transcript_path: join(src, 'a.jsonl'), cwd: sub }), { CLAUDE_PROJECT_DIR: undefined });
		assert.equal(r.status, 0, r.stderr);
		assert.deepEqual(readdirSync(join(project, 'etc/history/jsonl')), ['a.jsonl']);
		assert.equal(existsSync(join(sub, 'etc')), false, 'cd した先には作らない');
	});

	// 実環境でどちらが使われたかを確かめられるよう、SessionStart で渡す 1 行に、写し先の決め方を添える
	test('SessionStart の additionalContext に、写し先の決め方（環境変数・git・cwd）を添える', () => {
		const { src, sub } = prepare('dest3');
		const input = JSON.stringify({ transcript_path: join(src, 'a.jsonl'), cwd: sub, hook_event_name: 'SessionStart' });
		const byEnv = JSON.parse(run(copyHook, input, { CLAUDE_PROJECT_DIR: makeDir('dest3-env', true) }).stdout);
		assert.match(byEnv.hookSpecificOutput.additionalContext, /（写し先=CLAUDE_PROJECT_DIR）/);
		const byGit = JSON.parse(run(copyHook, input, { CLAUDE_PROJECT_DIR: undefined }).stdout);
		assert.match(byGit.hookSpecificOutput.additionalContext, /（写し先=git）/);
	});
});

describe('copy-session-jsonl の結果表示', () => {
	// 結果をユーザーに見せるため、標準出力の JSON の systemMessage を使う（モデルへは渡らない）
	const prepare = (name: string, event: string) => {
		const src = makeDir(name + '-src');
		const cwd = makeDir(name + '-cwd', true);
		writeFileSync(join(src, 'a.jsonl'), 'AAA\n');
		writeFileSync(join(src, 'b.jsonl'), 'BBB\n');
		return JSON.stringify({ transcript_path: join(src, 'a.jsonl'), cwd, hook_event_name: event });
	};

	test('SessionStart では、コピーした件数を ✅ で表示する', () => {
		const r = run(copyHook, prepare('show1', 'SessionStart'));
		assert.equal(r.status, 0, r.stderr);
		assert.equal(unstamp(JSON.parse(r.stdout).systemMessage), '✅ 会話ログを 2 件コピーした');
	});

	test('SessionStart では、変わっていなければ 0 件と表示する', () => {
		const input = prepare('show2', 'SessionStart');
		run(copyHook, input);
		const r = run(copyHook, input);
		assert.equal(unstamp(JSON.parse(r.stdout).systemMessage), '✅ 会話ログを 0 件コピーした');
	});

	// Stop は応答のたびに走る。成功を毎回出すと 1 行ずつ増え続ける
	test('Stop では、成功しても何も表示しない', () => {
		const r = run(copyHook, prepare('show3', 'Stop'));
		assert.equal(r.status, 0, r.stderr);
		assert.equal(r.stdout, '');
	});

	// cwd がファイルだと etc/history/jsonl を作れず、コピーに失敗する
	const failing = (name: string, event: string) => {
		const src = makeDir(name + '-src');
		writeFileSync(join(src, 'a.jsonl'), 'AAA\n');
		const notDir = join(work, name + '-notdir');
		writeFileSync(notDir, 'ファイル');
		return JSON.stringify({ transcript_path: join(src, 'a.jsonl'), cwd: notDir, hook_event_name: event });
	};

	for (const event of ['SessionStart', 'Stop']) {
		test(`${event} で失敗したら、❌ と理由を表示し、フック自体は正常終了する`, () => {
			const r = run(copyHook, failing('fail-' + event, event));
			assert.equal(r.status, 0, 'フックの失敗でセッションを止めない');
			const msg: string = unstamp(JSON.parse(r.stdout).systemMessage);
			assert.ok(msg.startsWith('❌ 会話ログのコピーに失敗した: '), msg);
		});
	}

	// 再開では、additionalContext が会話にある分と同じだと、同じ回の systemMessage ごと捨てられる（Claude Code の重複排除。
	// anthropics/claude-code の issue 96698）。毎回違う短い 1 行を渡し、同じ回に「新しい分」があるようにして、表示を残す
	test('SessionStart では、開始時刻（JST）を additionalContext として渡す', () => {
		const r = run(copyHook, prepare('ctx1', 'SessionStart'));
		const out = JSON.parse(r.stdout);
		assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
		assert.match(out.hookSpecificOutput.additionalContext, /^セッション開始: \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}\.\d{3} JST/);
		assert.equal(unstamp(out.systemMessage), '✅ 会話ログを 2 件コピーした', '表示は変わらない');
	});

	test('source があれば、additionalContext に添える', () => {
		const src = makeDir('ctx2-src');
		const cwd = makeDir('ctx2-cwd', true);
		writeFileSync(join(src, 'a.jsonl'), 'AAA\n');
		const input = JSON.stringify({ transcript_path: join(src, 'a.jsonl'), cwd, hook_event_name: 'SessionStart', source: 'resume' });
		const out = JSON.parse(run(copyHook, input).stdout);
		assert.ok(out.hookSpecificOutput.additionalContext.endsWith('（source=resume）'), out.hookSpecificOutput.additionalContext);
	});

	test('additionalContext は実行のたびに違う（同じだと重複排除されて、表示が捨てられるため）', () => {
		const input = prepare('ctx3', 'SessionStart');
		const a = JSON.parse(run(copyHook, input).stdout).hookSpecificOutput.additionalContext;
		const b = JSON.parse(run(copyHook, input).stdout).hookSpecificOutput.additionalContext;
		assert.notEqual(a, b);
	});

	test('SessionStart で失敗したときも、additionalContext を付ける（失敗の表示こそ捨てられたくない）', () => {
		const r = run(copyHook, failing('ctx4', 'SessionStart'));
		const out = JSON.parse(r.stdout);
		assert.ok(unstamp(out.systemMessage).startsWith('❌ '), out.systemMessage);
		assert.match(out.hookSpecificOutput.additionalContext, /^セッション開始: /);
	});

	// additionalContext は SessionStart の仕組み。Stop には付けない
	test('Stop で失敗したときは、additionalContext を付けない', () => {
		const out = JSON.parse(run(copyHook, failing('ctx5', 'Stop')).stdout);
		assert.ok(unstamp(out.systemMessage).startsWith('❌ '), out.systemMessage);
		assert.equal(out.hookSpecificOutput, undefined);
	});

	test('入力が JSON として読めなければ、❌ で表示して正常終了する', () => {
		const r = run(copyHook, 'これは JSON ではない');
		assert.equal(r.status, 0);
		const msg: string = unstamp(JSON.parse(r.stdout).systemMessage);
		assert.ok(msg.startsWith('❌ 会話ログのコピーに失敗した: '), msg);
	});
});

describe('load-obsidian-memory', () => {
	const makeVault = (name: string, text: string) => {
		const vault = makeDir(name);
		mkdirSync(join(vault, 'memory'), { recursive: true });
		writeFileSync(join(vault, 'memory/!memory.md'), text);
		return vault;
	};

	test('環境変数が指す Vault の memory/!memory.md を、SessionStart の additionalContext に注入する', () => {
		const vault = makeVault('mem1', '# テストメモリ\n- 日本語の行\n');
		const r = run(memoryHook, '{}', { AI_AGENT_OBSIDIAN_VAULT: vault });
		assert.equal(r.status, 0, r.stderr);
		const out = JSON.parse(r.stdout);
		assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
		const ctx: string = out.hookSpecificOutput.additionalContext;
		assert.ok(ctx.includes('# テストメモリ\n- 日本語の行\n'), '本文が日本語のまま入っている');
		assert.ok(ctx.includes('----- !memory.md ここから -----'));
		assert.ok(ctx.includes('----- !memory.md ここまで -----'));
	});

	// 連携していない PC でもフックが壊れないようにするため、注入せずに正常終了する。ユーザーへの表示だけは出す
	test('環境変数が未設定なら、何も注入せず正常終了し、⬜ で知らせる', () => {
		const r = run(memoryHook, '{}', { AI_AGENT_OBSIDIAN_VAULT: undefined });
		assert.equal(r.status, 0);
		const out = JSON.parse(r.stdout);
		assert.equal(unstamp(out.systemMessage), '⬜ Obsidian メモリ: 環境変数が未設定のため注入なし');
		assert.equal(out.hookSpecificOutput, undefined, '注入しない');
	});

	test('環境変数のパスに !memory.md が無ければ、何も注入せず正常終了し、⬜ で知らせる', () => {
		const r = run(memoryHook, '{}', { AI_AGENT_OBSIDIAN_VAULT: join(work, 'no-such-vault') });
		assert.equal(r.status, 0);
		const out = JSON.parse(r.stdout);
		assert.equal(unstamp(out.systemMessage), '⬜ Obsidian メモリ: !memory.md が無いため注入なし');
		assert.equal(out.hookSpecificOutput, undefined, '注入しない');
	});

	// systemMessage はユーザーにだけ見え、additionalContext（モデルへ渡す内容）とは別に出る
	test('注入に成功したら、additionalContext と一緒に ✅ の systemMessage を出す', () => {
		const vault = makeVault('mem2', '# メモリ\n');
		const r = run(memoryHook, '{}', { AI_AGENT_OBSIDIAN_VAULT: vault });
		const out = JSON.parse(r.stdout);
		assert.equal(unstamp(out.systemMessage), '✅ Obsidian メモリを注入した');
		assert.ok(out.hookSpecificOutput.additionalContext.includes('# メモリ'));
	});

	// 再開では、同じ内容が会話にあると Claude Code が取り込まない（重複排除）。フックには取り込まれたかが分からないので、
	// 「注入した」と言い切らず、「渡した」と書く
	test('再開（source=resume）では、「渡した（会話にあれば取り込まれない）」と表示する。additionalContext は変わらない', () => {
		const vault = makeVault('mem4', '# メモリ\n');
		const input = JSON.stringify({ hook_event_name: 'SessionStart', source: 'resume' });
		const out = JSON.parse(run(memoryHook, input, { AI_AGENT_OBSIDIAN_VAULT: vault }).stdout);
		assert.equal(unstamp(out.systemMessage), '✅ Obsidian メモリを渡した（再開では、会話にあれば取り込まれない）');
		assert.ok(out.hookSpecificOutput.additionalContext.includes('# メモリ'), '渡す内容は変わらない');
	});

	for (const source of ['startup', 'compact', 'clear']) {
		test(`${source} では、従来どおり「注入した」と表示する`, () => {
			const vault = makeVault('mem5-' + source, '# メモリ\n');
			const input = JSON.stringify({ hook_event_name: 'SessionStart', source });
			const out = JSON.parse(run(memoryHook, input, { AI_AGENT_OBSIDIAN_VAULT: vault }).stdout);
			assert.equal(unstamp(out.systemMessage), '✅ Obsidian メモリを注入した');
		});
	}

	test('再開でも、環境変数が未設定のときの ⬜ の文言は変わらない', () => {
		const input = JSON.stringify({ hook_event_name: 'SessionStart', source: 'resume' });
		const out = JSON.parse(run(memoryHook, input, { AI_AGENT_OBSIDIAN_VAULT: undefined }).stdout);
		assert.equal(unstamp(out.systemMessage), '⬜ Obsidian メモリ: 環境変数が未設定のため注入なし');
	});

	// !memory.md という名前のフォルダがあると、存在はするが読めない
	test('読み込みに失敗したら、❌ と理由を表示し、何も注入せず正常終了する', () => {
		const vault = makeDir('mem3');
		mkdirSync(join(vault, 'memory/!memory.md'), { recursive: true });
		const r = run(memoryHook, '{}', { AI_AGENT_OBSIDIAN_VAULT: vault });
		assert.equal(r.status, 0, 'フックの失敗でセッションを止めない');
		const out = JSON.parse(r.stdout);
		assert.ok(unstamp(out.systemMessage).startsWith('❌ Obsidian メモリの読み込みに失敗した: '), out.systemMessage);
		assert.equal(out.hookSpecificOutput, undefined, '注入しない');
	});
});

describe('表示の先頭の日時', () => {
	// 表示は「絵文字 + 月/日 時:分 + 本文」の形にする（例: ✅10/04 00:50 Obsidian メモリを注入した）。
	// いつの結果かが、画面だけで分かるようにするため。日時は JST
	const stampedForm = /^[✅⬜❌]\d{2}\/\d{2} \d{2}:\d{2} \S/;

	const makeVault = (name: string) => {
		const vault = makeDir(name);
		mkdirSync(join(vault, 'memory'), { recursive: true });
		writeFileSync(join(vault, 'memory/!memory.md'), '# メモリ\n');
		return vault;
	};

	test('stamped は、絵文字の直後に JST の月/日 時:分を入れる', async () => {
		const { stamped } = await import('../tools/80_ops/claude-hooks/jst.ts');
		// UTC 2026-10-03 15:50 は JST 2026-10-04 00:50
		assert.equal(stamped('✅ Obsidian メモリを注入した', Date.UTC(2026, 9, 3, 15, 50, 12)), '✅10/04 00:50 Obsidian メモリを注入した');
	});

	test('stamped は、月・日・時・分を 0 埋めし、年をまたぐ日付も JST で出す', async () => {
		const { stamped } = await import('../tools/80_ops/claude-hooks/jst.ts');
		// UTC 2026-12-31 15:05 は JST 2027-01-01 00:05
		assert.equal(stamped('❌ 失敗した', Date.UTC(2026, 11, 31, 15, 5)), '❌01/01 00:05 失敗した');
	});

	test('stamped は、絵文字で始まらない文言なら、先頭に日時を付ける', async () => {
		const { stamped } = await import('../tools/80_ops/claude-hooks/jst.ts');
		assert.equal(stamped('本文', Date.UTC(2026, 9, 3, 15, 50)), '10/04 00:50 本文');
	});

	test('load-obsidian-memory の表示は、成功・再開・⬜・❌ のすべてで、絵文字の直後に日時が付く', () => {
		const resume = JSON.stringify({ hook_event_name: 'SessionStart', source: 'resume' });
		const broken = makeDir('stamp-broken');
		mkdirSync(join(broken, 'memory/!memory.md'), { recursive: true });
		const cases: Array<[string, string, Record<string, string | undefined>]> = [
			['成功', '{}', { AI_AGENT_OBSIDIAN_VAULT: makeVault('stamp-ok') }],
			['再開', resume, { AI_AGENT_OBSIDIAN_VAULT: makeVault('stamp-resume') }],
			['環境変数が未設定', '{}', { AI_AGENT_OBSIDIAN_VAULT: undefined }],
			['!memory.md が無い', '{}', { AI_AGENT_OBSIDIAN_VAULT: join(work, 'stamp-no-such') }],
			['読み込みに失敗', '{}', { AI_AGENT_OBSIDIAN_VAULT: broken }],
		];
		for (const [name, input, env] of cases) {
			const msg: string = JSON.parse(run(memoryHook, input, env).stdout).systemMessage;
			assert.match(msg, stampedForm, `${name}: ${msg}`);
		}
	});

	test('copy-session-jsonl の表示は、成功と失敗（SessionStart・Stop）のどちらにも日時が付く', () => {
		const src = makeDir('stamp-copy-src');
		writeFileSync(join(src, 'a.jsonl'), 'AAA\n');
		const ok = JSON.stringify({ transcript_path: join(src, 'a.jsonl'), cwd: makeDir('stamp-copy-cwd', true), hook_event_name: 'SessionStart' });
		const notDir = join(work, 'stamp-notdir');
		writeFileSync(notDir, 'ファイル');
		const ng = (event: string) => JSON.stringify({ transcript_path: join(src, 'a.jsonl'), cwd: notDir, hook_event_name: event });
		for (const [name, input] of [['成功', ok], ['SessionStart の失敗', ng('SessionStart')], ['Stop の失敗', ng('Stop')]]) {
			const msg: string = JSON.parse(run(copyHook, input).stdout).systemMessage;
			assert.match(msg, stampedForm, `${name}: ${msg}`);
		}
	});

	test('日時は、実行した時刻（JST の月/日 時:分）である', () => {
		const jst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(5, 16).replace('T', ' ').replace('-', '/');
		const before = jst();
		const msg: string = JSON.parse(run(memoryHook, '{}', { AI_AGENT_OBSIDIAN_VAULT: makeVault('stamp-now') }).stdout).systemMessage;
		const after = jst();
		const shown = msg.slice(1, 12);
		assert.ok(shown === before || shown === after, `表示 ${shown} / 実行前 ${before} / 実行後 ${after}`);
	});
});
