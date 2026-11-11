import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findLeftovers, type Proc } from '../tools/80_ops/claude-hooks/check-leftover-processes.ts';

// 課題 i261111-06: Stop フックで、このセッションが起こした tail・grep・見張りの powershell が残っていれば知らせる。
// このセッションの本体 (claude-code の claude.exe) の子孫だけを見る。フック自身と、その子孫は数えない。
const p = (ProcessId: number, ParentProcessId: number, Name: string, CommandLine = Name): Proc => ({ ProcessId, ParentProcessId, Name, CommandLine });

const base: Proc[] = [
	p(1, 0, 'Claude.exe', 'Claude.exe'),
	p(10, 1, 'claude.exe', 'C:/x/claude-code/claude.exe'), // このセッションの本体
	p(11, 10, 'bash.exe'),
	p(12, 11, 'aichat.exe', 'aichat.exe wait :x: -p 8787 -r public'),
	p(20, 10, 'bash.exe'),
	p(21, 20, 'node.exe', 'node hook.ts'), // フック自身
	p(22, 21, 'powershell.exe', 'powershell -Command "Get-CimInstance Win32_Process"'),
	p(30, 1, 'claude.exe', 'C:/x/claude-code/claude.exe'), // 別のセッション
	p(31, 30, 'tail.exe', 'tail -F other.log'),
];

describe('findLeftovers (残ったプロセスを拾う)', () => {
	test('残りが無ければ空', () => {
		assert.deepEqual(findLeftovers(base, 21), []);
	});

	test('このセッションの tail・grep を拾う', () => {
		const list = [...base, p(13, 11, 'tail.exe', 'tail -F out.log'), p(14, 11, 'grep.exe', 'grep --line-buffered x')];
		assert.deepEqual(findLeftovers(list, 21).map((x) => x.ProcessId), [13, 14]);
	});

	test('見張りの形の powershell を拾い、そうでない powershell は拾わない', () => {
		const list = [...base, p(15, 11, 'powershell.exe', 'powershell -c "while ($true) { Start-Sleep 5 }"'), p(16, 11, 'pwsh.exe', 'pwsh -c "Get-Content a.log -Wait"'), p(17, 11, 'powershell.exe', 'powershell -c "Get-ChildItem"')];
		assert.deepEqual(findLeftovers(list, 21).map((x) => x.ProcessId), [15, 16]);
	});

	test('フック自身の子孫と、別のセッションの tail は拾わない', () => {
		const list = [...base, p(23, 21, 'tail.exe', 'tail -F x')];
		assert.deepEqual(findLeftovers(list, 21), []);
	});

	// Git Bash で背面に回すと、間の bash が先に終わり、残った tail は親のいない孤児になる (11/11 に実測)。
	// コマンド行にこのセッションの ID (作業フォルダ …/<セッション ID>/tasks/) があれば、このセッションのものとみなす
	test('親のいない孤児でも、コマンド行にこのセッションの ID があれば拾う', () => {
		const list = [...base, p(40, 999, 'tail.exe', 'tail -F C:/t/claude/sess-123/tasks/a.output'), p(41, 998, 'tail.exe', 'tail -F C:/t/claude/sess-999/tasks/b.output')];
		assert.deepEqual(findLeftovers(list, 21, 'sess-123').map((x) => x.ProcessId), [40]);
	});

	test('本体が見つからなければ空', () => {
		assert.deepEqual(findLeftovers([p(5, 0, 'bash.exe'), p(6, 5, 'tail.exe')], 6), []);
	});
});
