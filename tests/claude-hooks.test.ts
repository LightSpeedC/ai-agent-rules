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

// 呼び出しごとに、他のテストと干渉しない作業フォルダを作る
function makeDir(name: string): string {
	const dir = join(work, name);
	mkdirSync(dir, { recursive: true });
	return dir;
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
		const cwd = makeDir('copy1-cwd');
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
		const cwd = makeDir('copy2-cwd');
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
		const cwd = makeDir('copy3-cwd');
		writeFileSync(join(src, 'a.jsonl'), 'AAA\n');
		const input = JSON.stringify({ transcript_path: join(src, 'a.jsonl'), cwd });
		assert.equal(run(copyHook, input).status, 0);
		writeFileSync(join(src, 'a.jsonl'), 'AAA\nBBB\n');
		assert.equal(run(copyHook, input).status, 0);
		assert.equal(readFileSync(join(cwd, 'etc/history/jsonl/a.jsonl'), 'utf8'), 'AAA\nBBB\n');
	});

	test('コピーしたファイルの更新日時は元に揃う（次回のスキップ判定に使うため）', () => {
		const src = makeDir('copy4-src');
		const cwd = makeDir('copy4-cwd');
		writeFileSync(join(src, 'a.jsonl'), 'AAA\n');
		const old = new Date('2026-01-02T03:04:05.000Z');
		utimesSync(join(src, 'a.jsonl'), old, old);
		run(copyHook, JSON.stringify({ transcript_path: join(src, 'a.jsonl'), cwd }));
		assert.equal(statSync(join(cwd, 'etc/history/jsonl/a.jsonl')).mtime.getTime(), old.getTime());
	});

	test('transcript_path が実在しなければ、何もせず正常終了する', () => {
		const cwd = makeDir('copy5-cwd');
		const r = run(copyHook, JSON.stringify({ transcript_path: join(work, 'no-such/x.jsonl'), cwd }));
		assert.equal(r.status, 0);
		assert.equal(existsSync(join(cwd, 'etc')), false);
	});

	test('cwd が無ければ、何もせず正常終了する', () => {
		const src = makeDir('copy6-src');
		writeFileSync(join(src, 'a.jsonl'), 'AAA\n');
		const r = run(copyHook, JSON.stringify({ transcript_path: join(src, 'a.jsonl') }));
		assert.equal(r.status, 0);
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

	// 連携していない PC でもフックが壊れないようにするため
	test('環境変数が未設定なら、何も出力せず正常終了する', () => {
		const r = run(memoryHook, '{}', { AI_AGENT_OBSIDIAN_VAULT: undefined });
		assert.equal(r.status, 0);
		assert.equal(r.stdout, '');
	});

	test('環境変数のパスに !memory.md が無ければ、何も出力せず正常終了する', () => {
		const r = run(memoryHook, '{}', { AI_AGENT_OBSIDIAN_VAULT: join(work, 'no-such-vault') });
		assert.equal(r.status, 0);
		assert.equal(r.stdout, '');
	});
});
