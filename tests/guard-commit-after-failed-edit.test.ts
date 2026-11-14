import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

// 課題 i261101-01: 失敗したままの Edit・Write があれば、git commit を止める PreToolUse フック。
// 20261019-file-manager で、Edit の失敗を見ずに commit し、壊れたファイルが入った (#1727)。
// 印を解くのは、失敗の後の同じファイルへの Edit・Write か Read が通ったとき (決めることの 3-A)。
// 同じ応答に Edit と commit を並べた場合は、フックから失敗を知れない (11/05 実測。調査 r261105-01)。共通ルールで並べないと決めた (21-A)
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
function runHook(transcriptPath: string | undefined, command: string, toolName = 'Bash', cwd?: string): { denied: boolean; reason: string } {
	const input = JSON.stringify({ hook_event_name: 'PreToolUse', transcript_path: transcriptPath, tool_name: toolName, tool_input: { command }, cwd });
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

// 課題 i261101-01、11/04 に 20261019-file-manager から報告 (#1783)。14-A で決めた。
// 課題 i261114-02 (決定 424-A): worktree の子が、外 (親の checkout) の存在しないパスへの Edit に失敗すると、
// 同じ絶対パスでしか解けない印が残り、commit が止まった (file-manager、11/14)。commit に載るのは置き場の中のファイルだけなので、外のパスの失敗は数えない
describe('作業の置き場 (cwd) の外のパスの失敗 (424-A)', () => {
	const cwd = 'W:/proj';

	test('置き場の外のパスの失敗では、commit を止めない', () => {
		const t = transcript([edit('W:/parent/src/a.ts', true)]);
		assert.equal(runHook(t, 'git commit -m x', 'Bash', cwd).denied, false);
	});

	test('置き場の中のパスの失敗は、これまでどおり止める', () => {
		const t = transcript([edit('W:/proj/src/a.ts', true)]);
		assert.equal(runHook(t, 'git commit -m x', 'Bash', cwd).denied, true);
	});

	test('置き場の名前を前方に含むだけの別のフォルダ (W:/proj2) は、外とみなす', () => {
		const t = transcript([edit('W:/proj2/a.ts', true)]);
		assert.equal(runHook(t, 'git commit -m x', 'Bash', cwd).denied, false);
	});

	test('区切りと大小の違うパスでも、置き場の中なら止める', () => {
		const t = transcript([edit('w:\\Proj\\src\\a.ts', true)]);
		assert.equal(runHook(t, 'git commit -m x', 'Bash', 'W:/proj/').denied, true);
	});

	test('外の失敗と中の失敗が混ざれば、中の分だけで止め、理由に外のパスを書かない', () => {
		const t = transcript([edit('W:/parent/src/a.ts', true), edit('W:/proj/src/b.ts', true)]);
		const r = runHook(t, 'git commit -m x', 'Bash', cwd);
		assert.equal(r.denied, true);
		assert.ok(r.reason.includes('W:/proj/src/b.ts'), r.reason);
		assert.ok(!r.reason.includes('W:/parent'), r.reason);
	});

	test('cwd が渡されなければ、すべての失敗を数える (これまでどおり)', () => {
		const t = transcript([edit('W:/parent/src/a.ts', true)]);
		assert.equal(runHook(t, 'git commit -m x').denied, true);
	});
});

describe('--dry-run の commit (14-A)', () => {
	test('--dry-run の commit は、失敗した Edit があっても止めない (何も commit されないため)', () => {
		assert.equal(runHook(transcript([edit(fileA, true)]), 'git commit --dry-run').denied, false);
		assert.equal(runHook(transcript([edit(fileA, true)]), 'git -C "W:/proj" commit -m "x" --dry-run').denied, false);
	});

	test('--dry-run の commit は区切りにならない。そのあとの本物の commit は止める', () => {
		assert.equal(runHook(transcript([edit(fileA, true), bash('git commit --dry-run')]), 'git commit -m "x"').denied, true);
	});

	test('コミットメッセージの中の --dry-run の文字は、オプションとみなさず、止める', () => {
		assert.equal(runHook(transcript([edit(fileA, true)]), 'git commit -m "--dry-run を直す"').denied, true);
	});

	test('通った Edit の呼び出しが、結果の行の後に api-request-blob として入り直しても、失敗とみなさない', () => {
		// 記録には、結果の行の後に同じ呼び出しが入り直す (11/04 実測)。写しを数え直して、止めてしまわないこと
		const id = 'toolu_echo';
		const lines = [
			{ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Edit', input: { file_path: fileA, old_string: 'a', new_string: 'b' } }] } },
			{ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } },
			{ type: 'api-request-blob', message: { content: [{ type: 'tool_use', id, name: 'Edit', input: { file_path: fileA, old_string: 'a', new_string: 'b' } }] } },
		];
		const file = join(work, `echo${++seq}.jsonl`);
		writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
		assert.equal(runHook(file, 'git commit -m "x"').denied, false);
	});
});
