import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// 課題 i261108-03: html2md の生成物の .md を Edit・Write で直接書き換えるのを止める PreToolUse フック。
// ai-agent-tools で、.md だけを書き換えたあと html2md を流して内容が消える失敗が 2 度起きた (#1837)。
// 条件: 書き換える先が .md で、同じフォルダに同じ名前の .html (正本) があれば止める (13-A: deny)。
const root = resolve(import.meta.dirname, '..');
const hook = join(root, 'tools/80_ops/claude-hooks/guard-generated-md.ts');

function runHook(stdin: string): { denied: boolean; reason: string } {
	const r = spawnSync(process.execPath.includes('bun') ? 'node' : process.execPath, [hook], { input: stdin, encoding: 'utf8', timeout: 15000 });
	if (!r.stdout.trim()) return { denied: false, reason: '' };
	const out = JSON.parse(r.stdout);
	return { denied: out.hookSpecificOutput?.permissionDecision === 'deny', reason: out.hookSpecificOutput?.permissionDecisionReason ?? '' };
}

const call = (tool_name: string, tool_input: Record<string, unknown>) => runHook(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input }));

let dir = '';
before(() => {
	dir = mkdtempSync(join(tmpdir(), 'guard-md-'));
	writeFileSync(join(dir, 'README.html'), '<p>正本</p>');
	writeFileSync(join(dir, 'README.md'), '正本から作った');
	writeFileSync(join(dir, 'memo.md'), '手で書いた');
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe('止めるもの', () => {
	test('同じ名前の .html がある .md への Edit を止める', () => {
		const r = call('Edit', { file_path: join(dir, 'README.md'), old_string: 'a', new_string: 'b' });
		assert.equal(r.denied, true);
		assert.match(r.reason, /html2md/);
		assert.match(r.reason, /README\.html/);
	});
	test('同じ名前の .html がある .md への Write を止める', () => {
		assert.equal(call('Write', { file_path: join(dir, 'README.md'), content: 'x' }).denied, true);
	});
	test('.md がまだ無くても、.html があれば Write を止める', () => {
		writeFileSync(join(dir, 'new.html'), '<p>x</p>');
		assert.equal(call('Write', { file_path: join(dir, 'new.md'), content: 'x' }).denied, true);
	});
	test('/ 区切りのパスでも止める', () => {
		assert.equal(call('Edit', { file_path: join(dir, 'README.md').replaceAll('\\', '/'), old_string: 'a', new_string: 'b' }).denied, true);
	});
	test('拡張子が大文字の .MD でも止める', () => {
		assert.equal(call('Edit', { file_path: join(dir, 'README.MD'), old_string: 'a', new_string: 'b' }).denied, true);
	});
});

describe('通すもの', () => {
	test('同じ名前の .html が無い .md は通す', () => {
		assert.equal(call('Edit', { file_path: join(dir, 'memo.md'), old_string: 'a', new_string: 'b' }).denied, false);
	});
	test('.html そのものへの Edit は通す', () => {
		assert.equal(call('Edit', { file_path: join(dir, 'README.html'), old_string: 'a', new_string: 'b' }).denied, false);
	});
	test('Edit・Write 以外は通す', () => {
		assert.equal(call('Read', { file_path: join(dir, 'README.md') }).denied, false);
	});
	test('入力が JSON でなければ通す', () => {
		assert.equal(runHook('壊れた入力').denied, false);
	});
});
