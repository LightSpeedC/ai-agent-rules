import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// PostToolUse フック: Write で ps1・html・cmd・bat を書いた直後に convert-encoding を掛ける（依頼 #1672）
// フック本体は tools/80_ops/claude-hooks/ にある。テストは tmp/ の中だけを書き換える（本番の ~/.claude や REA に触れない）
const root = resolve(import.meta.dirname, '..');
const hook = join(root, 'tools/80_ops/claude-hooks/convert-after-write.ts');
const workRoot = join(root, 'tmp');

const BOM = [0xef, 0xbb, 0xbf];

function run(input: string) {
	// timeout は固まったことに気づく唯一の手段（同期 API は待ちを止めるため）
	const r = spawnSync('node', [hook], { input, timeout: 60000, encoding: 'utf8' });
	return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function writeEvent(filePath: string, toolName = 'Write') {
	return JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: toolName, tool_input: { file_path: filePath } });
}

function hasBom(bytes: Buffer): boolean {
	return BOM.every((b, i) => bytes[i] === b);
}

// SJIS の「テ」は 0x83 0x65。UTF-8 の「テ」（E3 86 86 系）とは別の並び
const SJIS_TE = Buffer.from([0x83, 0x65]);

let dir: string;

before(() => {
	mkdirSync(workRoot, { recursive: true });
	dir = mkdtempSync(join(workRoot, 'convert-after-write-'));
});

after(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe('convert-after-write（Write の後に文字コードと改行を揃える）', () => {
	// 通すための用途別の変換先（共通ルール「文字コード変換は convert-encoding」）
	test('ps1 を Write したら、BOM 付き UTF-8 ＋ CRLF にする', () => {
		const file = join(dir, 'a.ps1');
		writeFileSync(file, 'Write-Output "テスト"\n', 'utf8');
		const r = run(writeEvent(file));
		assert.equal(r.status, 0, r.stderr);
		const bytes = readFileSync(file);
		assert.ok(hasBom(bytes), 'BOM が付く');
		assert.ok(bytes.includes('\r\n'), 'CRLF になる');
	});

	test('html を Write したら、BOM 付き UTF-8 ＋ LF にする', () => {
		const file = join(dir, 'b.html');
		writeFileSync(file, '<!doctype html>\r\n<p>テスト</p>\r\n', 'utf8');
		const r = run(writeEvent(file));
		assert.equal(r.status, 0, r.stderr);
		const bytes = readFileSync(file);
		assert.ok(hasBom(bytes), 'BOM が付く');
		assert.ok(!bytes.includes('\r\n'), 'CRLF が残らない（LF になる）');
	});

	test('cmd を Write したら、SJIS ＋ CRLF にする', () => {
		const file = join(dir, 'c.cmd');
		writeFileSync(file, 'echo テスト\n', 'utf8');
		const r = run(writeEvent(file));
		assert.equal(r.status, 0, r.stderr);
		const bytes = readFileSync(file);
		assert.ok(!hasBom(bytes), 'BOM は付かない');
		assert.ok(bytes.includes(SJIS_TE), 'SJIS で書かれる');
		assert.ok(bytes.includes('\r\n'), 'CRLF になる');
	});

	test('bat も cmd と同じく、SJIS ＋ CRLF にする', () => {
		const file = join(dir, 'd.bat');
		writeFileSync(file, 'echo テスト\n', 'utf8');
		const r = run(writeEvent(file));
		assert.equal(r.status, 0, r.stderr);
		assert.ok(readFileSync(file).includes(SJIS_TE), 'SJIS で書かれる');
	});

	// 対象外の拡張子には触らない（ts・md などは別の決まりで扱う）
	test('対象外の拡張子（ts）は、書き換えない', () => {
		const file = join(dir, 'e.ts');
		const original = Buffer.from('const s = "テスト";\n', 'utf8');
		writeFileSync(file, original);
		const r = run(writeEvent(file));
		assert.equal(r.status, 0, r.stderr);
		assert.deepEqual(readFileSync(file), original);
	});

	// Write 以外（Edit など）の後では、何もしない
	test('Write 以外のツール（Edit）の後では、ps1 でも書き換えない', () => {
		const file = join(dir, 'f.ps1');
		const original = Buffer.from('Write-Output "テスト"\n', 'utf8');
		writeFileSync(file, original);
		const r = run(writeEvent(file, 'Edit'));
		assert.equal(r.status, 0, r.stderr);
		assert.deepEqual(readFileSync(file), original);
	});

	test('変換に成功したときは、何も表示しない（ユーザーに見せない）', () => {
		const file = join(dir, 'g.ps1');
		writeFileSync(file, 'Write-Output "テスト"\n', 'utf8');
		const r = run(writeEvent(file));
		assert.equal(r.status, 0, r.stderr);
		assert.equal(r.stdout, '');
	});

	// SJIS に無い文字（絵文字）を含むと、convert-encoding は書き換えずに止まる。その失敗は表示する
	test('変換できなかったときは、書き換えずに ❌ と理由を表示し、フックは正常終了する', () => {
		const file = join(dir, 'h.cmd');
		const original = Buffer.from('echo 😀\n', 'utf8');
		writeFileSync(file, original);
		const r = run(writeEvent(file));
		assert.equal(r.status, 0, r.stderr);
		assert.deepEqual(readFileSync(file), original, '元のまま');
		const out = JSON.parse(r.stdout);
		assert.match(out.systemMessage, /^❌\d{2}\/\d{2} \d{2}:\d{2} /);
	});

	test('入力が JSON として読めなければ、何もせず正常終了する（セッションを止めない）', () => {
		const r = run('JSON ではない');
		assert.equal(r.status, 0);
		assert.equal(r.stdout, '');
	});
});
