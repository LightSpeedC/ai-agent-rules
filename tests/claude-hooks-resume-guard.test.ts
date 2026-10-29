import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

// 課題 i261025-01: 再開時の張り直しの案内（remind-resume）と、Bash の sed・awk を止める案内（guard-bash-sed-awk）
// フック本体は tools/80_ops/claude-hooks/ にある。テストは本番の ~/.claude や REA に触れない
const root = resolve(import.meta.dirname, '..');
const hooksDir = join(root, 'tools/80_ops/claude-hooks');
// 再開の案内は SessionStart の入口（session-start.ts）から出る（p261027-01）
const remindHook = join(hooksDir, 'session-start.ts');
const guardHook = join(hooksDir, 'guard-bash-sed-awk.ts');

function run(script: string, input: string) {
	// 入口は Obsidian メモリも読む。本物の Vault と safe-push に触れないよう、環境変数を外す
	const env: NodeJS.ProcessEnv = { ...process.env };
	delete env.AI_AGENT_OBSIDIAN_VAULT;
	// timeout は固まったことに気づく唯一の手段（同期 API は待ちを止めるため）
	// 入口は、動かす処理を引数で選ぶ。settings.json と同じ 3 つを並べる
	const args = script === remindHook ? [script, 'copy', 'obsidian', 'resume'] : [script];
	const r = spawnSync('node', args, { input, env, timeout: 15000, encoding: 'utf8' });
	return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// 表示の先頭は「絵文字 + 月/日 時:分」。文言を比べるときは日時を外す
function unstamp(message: string): string {
	return message.replace(/^(\S)\d{2}\/\d{2} \d{2}:\d{2} /, '$1 ');
}

describe('remind-resume（再開時の張り直しの案内）', () => {
	const input = (source: string) => JSON.stringify({ hook_event_name: 'SessionStart', source });

	test('再開（source=resume）では、cron と chat 待受けの張り直しを additionalContext で案内する', () => {
		const r = run(remindHook, input('resume'));
		assert.equal(r.status, 0, r.stderr);
		const ctx: string = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
		assert.match(ctx, /cron/);
		assert.match(ctx, /chat 待受け/);
		assert.match(ctx, /張り直す/);
	});

	// 予定を過ぎた cron を、指示を待たずにすぐ実行させる（作り直し漏れ 4 回の対策）
	test('案内には、cron の予定を過ぎていればすぐ実行することを含む', () => {
		const ctx: string = JSON.parse(run(remindHook, input('resume')).stdout).hookSpecificOutput.additionalContext;
		assert.match(ctx, /予定を過ぎていれば、すぐ実行/);
	});

	// 手順を写さず、見出し名で指す（共通ルール「手順は 1 箇所に置く」）。見出しは全プロジェクトで同じ名前とは限らないため、
	// ローカルルールは見出しで指さず「ローカルルールに定義があれば」と書く（#1643: 別のプロジェクトに無い見出しが出た）
	test('案内は手順を写さず、共通ルールの見出し名で指し、ローカルルールは見出し名で指さない', () => {
		const ctx: string = JSON.parse(run(remindHook, input('resume')).stdout).hookSpecificOutput.additionalContext;
		assert.match(ctx, /セッションを開き直したとき/);
		assert.match(ctx, /ローカルルールに定義があれば/);
		assert.doesNotMatch(ctx, /chat 待受け・共通ルールの追随の点検/);
	});

	test('compact でも、同じ案内を出す', () => {
		const r = run(remindHook, input('compact'));
		assert.equal(r.status, 0, r.stderr);
		assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /張り直す/);
	});

	// フックは応答を始められない。張り直しが始まるのは次の発言を受けてからなので、文言もそう書く（p261027-01 の 3-A）
	test('案内は「次の発言を受けたら、本題の前に張り直す」と書き、「指示を待たずに」とは書かない', () => {
		const ctx: string = JSON.parse(run(remindHook, input('resume')).stdout).hookSpecificOutput.additionalContext;
		assert.match(ctx, /次の発言を受けたら、本題の前に張り直す/);
		assert.doesNotMatch(ctx, /指示を待たずに/);
	});

	test('新規（startup）では、再開の案内を出さずに正常終了する', () => {
		const r = run(remindHook, input('startup'));
		assert.equal(r.status, 0, r.stderr);
		assert.doesNotMatch(r.stdout, /🔁|張り直/);
	});

	// 同じ文が会話にあると Claude Code が捨てる（重複排除）ため、実行のたびに違う文にする（時刻を入れる）
	test('実行のたびに additionalContext が違う（重複排除で捨てられないため）', () => {
		const a = JSON.parse(run(remindHook, input('resume')).stdout).hookSpecificOutput.additionalContext;
		const b = JSON.parse(run(remindHook, input('resume')).stdout).hookSpecificOutput.additionalContext;
		assert.notEqual(a, b);
	});

	test('再開では、ユーザーへの表示として 🔁 の systemMessage を出す', () => {
		const out = JSON.parse(run(remindHook, input('resume')).stdout);
		// 🔁 は UTF-16 で 2 文字のため、unstamp の \S では外せない。日時の位置ごと確かめる
		assert.match(out.systemMessage, /^🔁\d{2}\/\d{2} \d{2}:\d{2} 再開: .*張り直し/m);
	});

	test('入力が JSON として読めなくても、再開の案内を出さずに正常終了する（セッションを止めない）', () => {
		const r = run(remindHook, 'JSON ではない');
		assert.equal(r.status, 0);
		assert.doesNotMatch(r.stdout, /🔁|張り直/);
	});
});

describe('guard-bash-sed-awk（Bash の sed・awk を止め、Edit・Read を案内する）', () => {
	const bash = (command: string) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
	const decision = (stdout: string) => (stdout === '' ? undefined : JSON.parse(stdout).hookSpecificOutput);

	for (const command of [
		'sed -n 1,5p a.txt',
		'awk "{print}" a.txt',
		'git status | awk "{print}"',
		'echo ok && sed -i s/a/b/ f',
		'false || sed -n 1p f',
		'echo ok; sed -n 1p f',
		'echo ok\nawk "{print}" f',
	]) {
		test(`「${command.replace(/\n/g, '\\n')}」を deny し、Edit・Read を理由に書く`, () => {
			const r = run(guardHook, bash(command));
			assert.equal(r.status, 0, r.stderr);
			const d = decision(r.stdout);
			assert.ok(d, 'deny の出力がある');
			assert.equal(d.hookEventName, 'PreToolUse');
			assert.equal(d.permissionDecision, 'deny');
			assert.match(d.permissionDecisionReason, /Edit/);
			assert.match(d.permissionDecisionReason, /Read/);
		});
	}

	// 引数の中に sed という語があるだけのものは止めない（先頭語で判定する）
	for (const command of ['git status', 'echo sed', 'grep sed file.txt', 'cat a.txt | grep awk', 'node --test tests']) {
		test(`「${command}」は止めない（先頭語が sed・awk ではない）`, () => {
			const r = run(guardHook, bash(command));
			assert.equal(r.status, 0, r.stderr);
			assert.equal(r.stdout, '');
		});
	}

	test('Bash 以外のツールは、コマンドの文字があっても止めない', () => {
		const r = run(guardHook, JSON.stringify({ tool_name: 'PowerShell', tool_input: { command: 'sed -n 1p f' } }));
		assert.equal(r.status, 0, r.stderr);
		assert.equal(r.stdout, '');
	});

	test('入力が JSON として読めなければ、止めずに正常終了する（セッションを止めない）', () => {
		const r = run(guardHook, 'JSON ではない');
		assert.equal(r.status, 0);
		assert.equal(r.stdout, '');
	});
});
