import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

// 課題 i261103-02: 会話の記録 (JSONL) が 50 MB 以上になったら、Stop フックで引継ぎの提案を促す。
// AI は記録の大きさを自分では知れないため (共通ルール「会話の記録が大きくなったら引き継ぐ」)。圧縮の回数は見ない。
// 促すのは、条件に当たった後の最初の 1 回だけ。促した結果の Stop (stop_hook_active) では促さない。
const root = resolve(import.meta.dirname, '..');
const hook = join(root, 'tools/80_ops/claude-hooks/handoff-reminder.ts');

let work = '';
let seq = 0;

before(() => {
	mkdirSync(join(root, 'tmp'), { recursive: true });
	work = mkdtempSync(join(root, 'tmp/handoff-test-'));
});

after(() => {
	rmSync(work, { recursive: true, force: true });
});

const summary = JSON.stringify({ type: 'user', isCompactSummary: true, message: { role: 'user', content: '要約' } });
const plain = JSON.stringify({ type: 'user', message: { role: 'user', content: '発言' } });
const big = 50 * 1024 * 1024;

// 圧縮 compactions 回、大きさが約 bytes バイトの記録を書く。セッションごとに別名にする (印は記録の名前で持つ)
function transcript(compactions: number, bytes: number): string {
	const lines: string[] = [];
	for (let i = 0; i < compactions; i++) lines.push(summary);
	let text = lines.join('\n') + (lines.length ? '\n' : '');
	while (text.length < bytes) text += plain + '\n';
	const file = join(work, `session-${seq++}.jsonl`);
	writeFileSync(file, text);
	return file;
}

function run(file: string, extra: Record<string, unknown> = {}) {
	const r = spawnSync(process.execPath, [hook], {
		input: JSON.stringify({ hook_event_name: 'Stop', transcript_path: file, ...extra }),
		encoding: 'utf8',
		env: { ...process.env, CLAUDE_HANDOFF_MARK_DIR: join(work, 'marks') },
		timeout: 15000,
	});
	assert.equal(r.status, 0, '終了コードは常に 0');
	return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

describe('引継ぎの提案を促す Stop フック', () => {
	test('50 MB 未満なら促さない (10 MB を超えていても)', () => {
		assert.equal(run(transcript(0, 11 * 1024 * 1024)), null);
	});

	test('50 MB 以上なら促す', () => {
		const out = run(transcript(0, big));
		assert.equal(out.decision, 'block');
		assert.match(out.reason, /引継ぎ/);
		assert.match(out.reason, /50 MB 以上/);
	});

	test('圧縮の回数は見ない。圧縮が多くても 50 MB 未満なら促さない', () => {
		assert.equal(run(transcript(20, 1024)), null);
	});

	test('促した後の最初の 1 回だけ。同じセッションの次の Stop では促さない', () => {
		const file = transcript(0, big);
		assert.equal(run(file).decision, 'block');
		assert.equal(run(file), null);
	});

	test('促した結果の Stop (stop_hook_active) では促さず、印も付けない', () => {
		const file = transcript(0, big);
		assert.equal(run(file, { stop_hook_active: true }), null);
		assert.equal(run(file).decision, 'block');
	});

	test('記録が読めないときは促さない (フックの不具合で止め続けない)', () => {
		assert.equal(run(join(work, 'ない.jsonl')), null);
	});

	test('記録の名前が渡されないときは促さない', () => {
		assert.equal(run(''), null);
	});
});
