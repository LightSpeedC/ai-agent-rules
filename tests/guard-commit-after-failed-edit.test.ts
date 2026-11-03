import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

// 課題 i261101-01: 失敗したままの Edit・Write があれば、git commit を止める PreToolUse フック。
// 20261019-file-manager で、Edit の失敗を見ずに commit し、壊れたファイルが入った (#1727)。
// 印を解くのは、失敗の後の同じファイルへの Edit・Write か Read が通ったとき (決めることの 3-A)。
const root = resolve(import.meta.dirname, '..');
const hook = join(root, 'tools/80_ops/claude-hooks/guard-commit-after-failed-edit.ts');

let work = '';
let seq = 0;

before(() => {
	mkdirSync(join(root, 'tmp'), { recursive: true });
	work = mkdtempSync(join(root, 'tmp/guard-commit-test-'));
});

after(() => {
	rmSync(work, { recursive: true, force: true });
});

type Step = { name: string; input: Record<string, unknown>; error: boolean };

// ツールの呼び出しと結果の組を、会話の記録 (JSONL) の形に並べて書く
function transcript(steps: Step[]): string {
	const lines: unknown[] = [{ type: 'user', message: { role: 'user', content: '始めて' } }];
	for (const s of steps) {
		const id = `toolu_${++seq}`;
		lines.push({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: s.name, input: s.input }] } });
		lines.push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: s.error ? '<tool_use_error>String to replace not found in file.</tool_use_error>' : 'ok', ...(s.error ? { is_error: true } : {}) }] } });
	}
	const file = join(work, `t${seq}.jsonl`);
	writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
	return file;
}

const edit = (file: string, error = false): Step => ({ name: 'Edit', input: { file_path: file, old_string: 'a', new_string: 'b' }, error });
const read = (file: string): Step => ({ name: 'Read', input: { file_path: file }, error: false });
const bash = (command: string, error = false): Step => ({ name: 'Bash', input: { command }, error });

// フックを実際に node で起動し、止めたかどうかを返す
function runHook(transcriptPath: string | undefined, command: string, toolName = 'Bash'): { denied: boolean; reason: string } {
	const input = JSON.stringify({ hook_event_name: 'PreToolUse', transcript_path: transcriptPath, tool_name: toolName, tool_input: { command } });
	const r = spawnSync('node', [hook], { input, timeout: 15000, encoding: 'utf8' });
	try {
		const out = JSON.parse(r.stdout).hookSpecificOutput;
		return { denied: out?.permissionDecision === 'deny', reason: out?.permissionDecisionReason ?? '' };
	} catch {
		return { denied: false, reason: '' };
	}
}

const fileA = 'W:/proj/src/a.ts';

describe('guard-commit-after-failed-edit (失敗したままの Edit の後の commit を止める)', () => {
	test('失敗したままの Edit があれば、git commit を止め、理由にファイル名を書く', () => {
		const r = runHook(transcript([edit(fileA, true)]), 'git commit -m "x"');
		assert.equal(r.denied, true);
		assert.match(r.reason, /a\.ts/);
	});

	test('PowerShell のツールからの git commit も止める', () => {
		assert.equal(runHook(transcript([edit(fileA, true)]), 'git commit -m "x"', 'PowerShell').denied, true);
	});

	test('失敗の後に同じファイルへの Edit が通れば、止めない', () => {
		assert.equal(runHook(transcript([edit(fileA, true), edit(fileA)]), 'git commit -m "x"').denied, false);
	});

	test('失敗の後に同じファイルを Read すれば、止めない', () => {
		assert.equal(runHook(transcript([edit(fileA, true), read(fileA)]), 'git commit -m "x"').denied, false);
	});

	test('通った commit より前の失敗では止めない', () => {
		assert.equal(runHook(transcript([edit(fileA, true), bash('git commit -m "y"')]), 'git commit -m "x"').denied, false);
	});

	test('失敗した commit は区切りにならない', () => {
		assert.equal(runHook(transcript([edit(fileA, true), bash('git commit -m "y"', true)]), 'git commit -m "x"').denied, true);
	});

	test('commit でないコマンドは通す', () => {
		assert.equal(runHook(transcript([edit(fileA, true)]), 'git status').denied, false);
	});

	test('git -C <path> commit と、&& の後ろの commit も止める', () => {
		const t = transcript([edit(fileA, true)]);
		assert.equal(runHook(t, 'git -C "W:/proj" commit -m "x"').denied, true);
		assert.equal(runHook(t, 'git add a.ts && git -c core.quotepath=false commit -m "x"').denied, true);
	});

	test('大小と区切りの違うパスを、同じファイルとみなす', () => {
		assert.equal(runHook(transcript([edit(fileA, true), read('w:\\proj\\SRC\\a.ts')]), 'git commit -m "x"').denied, false);
	});

	test('会話の記録が無ければ止めない', () => {
		assert.equal(runHook(undefined, 'git commit -m "x"').denied, false);
		assert.equal(runHook(join(work, 'none.jsonl'), 'git commit -m "x"').denied, false);
	});
});
