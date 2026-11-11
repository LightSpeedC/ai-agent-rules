import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { choiceNumbers } from '../tools/80_ops/claude-hooks/check-choice-numbers.ts';

// 課題 i261111-05: Stop フックで、応答に書いた選択肢の番号 (NNN-A) が issue choice next の予約に無ければ知らせる。
// 予約の置き場は <numbers>/uuid_<uuid>_<名前>/choices/<番号>/。決定 (decisions/) に記録済みの番号も、使ってよい番号として数える。
const root = resolve(import.meta.dirname, '..');
const hook = join(root, 'tools/80_ops/claude-hooks/check-choice-numbers.ts');
const uuid = '0123456789abcdef0123456789abcdef';

let work = '';
let project = '';
let numbers = '';

before(() => {
	mkdirSync(join(root, 'tmp'), { recursive: true });
	work = mkdtempSync(join(root, 'tmp/choice-test-'));
	project = join(work, 'proj');
	mkdirSync(join(project, 'notes/40_issues/items'), { recursive: true });
	mkdirSync(join(project, 'notes/40_issues/decisions'), { recursive: true });
	writeFileSync(join(project, 'notes/40_issues/items/project-uuid.txt'), `schema: 2\nproject_uuid: ${uuid}\nproject_id: proj\n`);
	writeFileSync(join(project, 'notes/40_issues/decisions/i1-d1-x.md'), '---\nlegacy_ids: [":proj:16-A"]\n---\n');
	numbers = join(work, 'numbers');
	mkdirSync(join(numbers, `uuid_${uuid}_proj/choices/419`), { recursive: true });
});

after(() => {
	rmSync(work, { recursive: true, force: true });
});

const user = (text: string) => ({ type: 'user', message: { role: 'user', content: text } });
const assistant = (text: string) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });

function run(name: string, texts: string[], active = false): { status: number | null; out: any } {
	const file = join(work, name + '.jsonl');
	writeFileSync(file, [user('始めて'), ...texts.map(assistant)].map((l) => JSON.stringify(l)).join('\n') + '\n');
	const r = spawnSync('node', [hook], {
		input: JSON.stringify({ hook_event_name: 'Stop', transcript_path: file, cwd: project, stop_hook_active: active }),
		encoding: 'utf8', timeout: 15000, env: { ...process.env, AI_AGENT_TOOLS_NUMBERS_DIR: numbers },
	});
	return { status: r.status, out: r.stdout.trim() === '' ? null : JSON.parse(r.stdout) };
}

describe('choiceNumbers (応答から選択肢の番号を拾う)', () => {
	test('NNN-A の形を拾い、課題の番号や日付は拾わない', () => {
		assert.deepEqual(choiceNumbers('案は **419-A** と 419-B。課題 i261110-0r、2026-11-11。'), ['419']);
	});

	test('コードの中の番号は拾わない', () => {
		assert.deepEqual(choiceNumbers('`12-A` と\n```\n13-B\n```\n'), []);
	});
});

describe('check-choice-numbers (Stop フック)', () => {
	test('予約した番号だけなら、何も出さない', () => {
		const r = run('ok', ['**419-A** (おすすめ) と 419-B のどちらにしますか。']);
		assert.equal(r.status, 0);
		assert.equal(r.out, null);
	});

	test('決定に記録済みの旧番号は、使ってよい番号として数える', () => {
		assert.equal(run('legacy', ['前に決めた 16-A のとおりです。']).out, null);
	});

	test('予約に無い番号があれば止めて、その番号を知らせる', () => {
		const r = run('ng', ['**420-A** と 420-B のどちらにしますか。']);
		assert.equal(r.out.decision, 'block');
		assert.match(r.out.reason, /420/);
		assert.match(r.out.reason, /issue choice next/);
	});

	test('止めた後の Stop (stop_hook_active) では、止めずに知らせるだけ', () => {
		const r = run('active', ['**420-A** です。'], true);
		assert.equal(r.out.decision, undefined);
		assert.match(r.out.systemMessage, /420/);
	});

	test('issue を使っていないプロジェクトでは、何も出さない', () => {
		const file = join(work, 'none.jsonl');
		writeFileSync(file, JSON.stringify(assistant('**420-A** です。')) + '\n');
		const r = spawnSync('node', [hook], { input: JSON.stringify({ hook_event_name: 'Stop', transcript_path: file, cwd: work }), encoding: 'utf8', timeout: 15000, env: { ...process.env, AI_AGENT_TOOLS_NUMBERS_DIR: numbers } });
		assert.equal(r.status, 0);
		assert.equal(r.stdout.trim(), '');
	});
});
