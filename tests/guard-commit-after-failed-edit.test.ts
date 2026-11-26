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
// 失敗したパスは、ディスクに在るものだけを数える (i261119-02)。試験のパスは、実ファイルにする
let fileA = '';
let fileB = '';
let parentFile = '';
let proj2File = '';

function touch(file: string): string {
	mkdirSync(join(file, '..'), { recursive: true });
	writeFileSync(file, 'x');
	return file;
}

before(() => {
	mkdirSync(join(root, 'tmp'), { recursive: true });
	work = mkdtempSync(join(root, 'tmp/guard-commit-test-'));
	fileA = touch(join(work, 'proj/src/a.ts'));
	fileB = touch(join(work, 'proj/src/b.ts'));
	parentFile = touch(join(work, 'parent/src/a.ts'));
	proj2File = touch(join(work, 'proj2/a.ts'));
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
		assert.equal(runHook(transcript([edit(fileA, true), read(fileA.replace(/\//g, '\\').toUpperCase())]), 'git commit -m "x"').denied, false);
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
	// 外のパスも実ファイルにして、外だから数えないことを確かめる (無いから数えない、との取り違えを防ぐ)
	const cwd = () => join(work, 'proj');

	test('置き場の外のパスの失敗では、commit を止めない', () => {
		const t = transcript([edit(parentFile, true)]);
		assert.equal(runHook(t, 'git commit -m x', 'Bash', cwd()).denied, false);
	});

	test('置き場の中のパスの失敗は、これまでどおり止める', () => {
		const t = transcript([edit(fileA, true)]);
		assert.equal(runHook(t, 'git commit -m x', 'Bash', cwd()).denied, true);
	});

	test('置き場の名前を前方に含むだけの別のフォルダ (proj2) は、外とみなす', () => {
		const t = transcript([edit(proj2File, true)]);
		assert.equal(runHook(t, 'git commit -m x', 'Bash', cwd()).denied, false);
	});

	test('区切りと大小の違うパスでも、置き場の中なら止める', () => {
		const t = transcript([edit(fileA.replace(/\//g, '\\').toUpperCase(), true)]);
		assert.equal(runHook(t, 'git commit -m x', 'Bash', cwd() + '/').denied, true);
	});

	test('外の失敗と中の失敗が混ざれば、中の分だけで止め、理由に外のパスを書かない', () => {
		const t = transcript([edit(parentFile, true), edit(fileB, true)]);
		const r = runHook(t, 'git commit -m x', 'Bash', cwd());
		assert.equal(r.denied, true);
		assert.ok(r.reason.includes('b.ts'), r.reason);
		assert.ok(!r.reason.includes('parent'), r.reason);
	});

	test('cwd が渡されなければ、すべての失敗を数える (これまでどおり)', () => {
		const t = transcript([edit(parentFile, true)]);
		assert.equal(runHook(t, 'git commit -m x').denied, true);
	});
});

// 課題 i261119-02、11/19 に file-manager から報告 (#2057)。存在しないパスへの Edit が失敗すると、Read も Edit も通せず印が解けず、
// そのセッションの commit が全部止まった。ディスクに無いファイルは壊れようがなく、commit にも載らないため、数えない
describe('ディスクに存在しないパスの失敗', () => {
	test('存在しないパスへの Edit の失敗では、commit を止めない', () => {
		const missing = join(work, 'no-such-dir', 'a.ts');
		assert.equal(runHook(transcript([edit(missing, true)]), 'git commit -m x', 'Bash', work).denied, false);
	});

	test('存在するパスへの Edit の失敗は、これまでどおり止める', () => {
		const exists = join(work, 'exists.ts');
		writeFileSync(exists, 'x');
		const r = runHook(transcript([edit(exists, true)]), 'git commit -m x', 'Bash', work);
		assert.equal(r.denied, true);
		assert.match(r.reason, /exists\.ts/);
	});

	test('存在しないパスの失敗と存在するパスの失敗が混ざれば、存在する分だけで止め、理由に存在しないパスを書かない', () => {
		const exists = join(work, 'exists2.ts');
		writeFileSync(exists, 'x');
		const missing = join(work, 'no-such-dir', 'b.ts');
		const r = runHook(transcript([edit(missing, true), edit(exists, true)]), 'git commit -m x', 'Bash', work);
		assert.equal(r.denied, true);
		assert.ok(r.reason.includes('exists2.ts'), r.reason);
		assert.ok(!r.reason.includes('no-such-dir'), r.reason);
	});

	// レビューの指摘 (抜け出せない穴)。フォルダは Read も Edit も通せず、印が解けない
	test('フォルダを指すパスの失敗では、commit を止めない', () => {
		const t = transcript([{ name: 'Write', input: { file_path: join(work, 'proj'), content: 'x' }, error: true }]);
		assert.equal(runHook(t, 'git commit -m x', 'Bash', work).denied, false);
	});

	test('.. を含むパスで失敗しても、畳んだ同じパスで Edit が通れば解ける', () => {
		const odd = work.replace(/\\/g, '/') + '/proj/src/../src/a.ts'; // join は .. を畳むので、文字列でつなぐ
		assert.equal(runHook(transcript([edit(odd, true), edit(fileA)]), 'git commit -m x', 'Bash', work).denied, false);
	});

	test('失敗の後に、同じパスが削除されたら、止めない', () => {
		const gone = touch(join(work, 'gone.ts'));
		const t = transcript([edit(gone, true)]);
		rmSync(gone);
		assert.equal(runHook(t, 'git commit -m x', 'Bash', work).denied, false);
	});

	test('Write の失敗でも、存在しないパスなら止めない', () => {
		const missing = join(work, 'no-such-dir', 'c.ts');
		const t = transcript([{ name: 'Write', input: { file_path: missing, content: 'x' }, error: true }]);
		assert.equal(runHook(t, 'git commit -m x', 'Bash', work).denied, false);
	});
});

// 課題 i261121-03 の穴 5: git.exe commit・& git commit・bash -c "git commit" が isCommit に当たらず、止めなかった
describe('git の別の呼び方の commit (i261121-03 の穴 5)', () => {
	const t = () => transcript([edit(fileA, true)]);

	test('git.exe commit を止める', () => {
		assert.equal(runHook(t(), 'git.exe commit -m "x"').denied, true);
		assert.equal(runHook(t(), 'git.exe -C "D:/dummy/proj" commit -m "x"').denied, true);
	});

	test('PowerShell の & git commit・& "git.exe" commit を止める', () => {
		assert.equal(runHook(t(), '& git commit -m "x"', 'PowerShell').denied, true);
		assert.equal(runHook(t(), '& "D:/dummy/git/git.exe" commit -m "x"', 'PowerShell').denied, true);
	});

	test('bash -c "git commit ..." (sh -c・単引用符も) を止める', () => {
		assert.equal(runHook(t(), 'bash -c "git commit -m x"').denied, true);
		assert.equal(runHook(t(), "sh -c 'git commit -m x'").denied, true);
		assert.equal(runHook(t(), 'bash -lc "git add a && git commit -m x"').denied, true);
	});

	test('別の呼び方でも、--dry-run の commit と、commit でないものは止めない', () => {
		assert.equal(runHook(t(), 'git.exe commit --dry-run').denied, false);
		assert.equal(runHook(t(), 'bash -c "git commit --dry-run"').denied, false);
		assert.equal(runHook(t(), 'bash -c "git status"').denied, false);
		assert.equal(runHook(t(), '& git status', 'PowerShell').denied, false);
	});

	test('別の呼び方の通った commit は区切りになる', () => {
		assert.equal(runHook(transcript([edit(fileA, true), bash('git.exe commit -m y')]), 'git commit -m x').denied, false);
	});
});

describe('穴 5 の追加 (psh・cmd・commit-tree・引用符)', () => {
	const t = () => transcript([edit(fileA, true)]);

	test('psh -c・cmd /c・powershell -Command・pwsh -Command の中の commit を止める', () => {
		assert.equal(runHook(t(), 'psh -c "git commit -m x"').denied, true);
		assert.equal(runHook(t(), 'cmd /c "git commit -m x"').denied, true);
		assert.equal(runHook(t(), 'powershell.exe -NoProfile -Command "git commit -m x"').denied, true);
		assert.equal(runHook(t(), 'pwsh -Command "git commit -m x"').denied, true);
	});

	test('バックスラッシュ入りのパスの & \'D:\\dummy\\git\\git.exe\' commit を止める', () => {
		assert.equal(runHook(t(), "& 'D:\\dummy\\git\\git.exe' commit -m x", 'PowerShell').denied, true);
	});

	test('git commit-tree・commit-graph は commit ではないので止めない', () => {
		assert.equal(runHook(t(), 'git commit-tree abc').denied, false);
		assert.equal(runHook(t(), 'git commit-graph write').denied, false);
	});

	test('通った commit-tree・commit-graph は区切りにならない', () => {
		assert.equal(runHook(transcript([edit(fileA, true), bash('git commit-graph write')]), 'git commit -m x').denied, true);
		assert.equal(runHook(transcript([edit(fileA, true), bash('git commit-tree abc')]), 'git commit -m x').denied, true);
	});

	test('bash -c の中の通った commit は区切りになる', () => {
		assert.equal(runHook(transcript([edit(fileA, true), bash('bash -c "git commit -m y"')]), 'git commit -m x').denied, false);
	});

	test('引用符の中の文字列・here-string の中の bash -c は commit とみなさない', () => {
		assert.equal(runHook(t(), `echo "x bash -c 'git commit -m x'"`).denied, false);
		assert.equal(runHook(t(), 'cat <<EOF\nbash -c "git commit"\nEOF').denied, false);
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
