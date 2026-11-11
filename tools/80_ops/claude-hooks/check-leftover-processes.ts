// Stop フック: このセッションが起こした tail・grep・見張りの powershell が残っていれば知らせる (課題 i261111-06、ai-agent-tools の依頼 #1923)。
// 共通ルール「短く終わるはずの作業は、見張る」の後始末 (見張りのプロセスを止める) を機械的に確かめる。
// このセッションの本体は、フックから親をたどって最初に当たる claude-code の claude.exe。その子孫だけを見る (別のセッションの分には触れない)。
// プロセスの親子は CIM (Get-CimInstance Win32_Process) で取る。psls には機械が読める出力が無いため。
// 止めるのは 1 回まで。stop_hook_active が true なら止めずに知らせるだけ。Windows 以外と、取れなかったときは何もしない。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { execFileSync } from 'node:child_process';
import { stamped } from './jst.ts';
import { readInput } from './vault.ts';

export type Proc = { ProcessId: number; ParentProcessId: number; Name: string; CommandLine: string | null };

const WATCH_NAMES = /^(tail|grep)(\.exe)?$/i;
const SHELL_NAMES = /^(powershell|pwsh)(\.exe)?$/i;
const WATCH_SHELL = /-Wait\b|-Tail\b|\bwhile\b|Start-Sleep/i;

function isSessionRoot(proc: Proc): boolean {
	return /^claude(\.exe)?$/i.test(proc.Name) && /claude-code/i.test(proc.CommandLine ?? '');
}

function isWatcher(proc: Proc): boolean {
	return WATCH_NAMES.test(proc.Name) || (SHELL_NAMES.test(proc.Name) && WATCH_SHELL.test(proc.CommandLine ?? ''));
}

// sessionId を渡すと、親のいない孤児でも、コマンド行にその ID がある見張りを拾う。
// Git Bash で背面に回すと、間の bash が先に終わり、残った tail は本体からたどれなくなる (11/11 に実測)
export function findLeftovers(procs: Proc[], selfPid: number, sessionId?: string): Proc[] {
	const orphans = sessionId ? procs.filter((proc) => isWatcher(proc) && (proc.CommandLine ?? '').includes(sessionId)) : [];
	return [...new Map([...descendants(procs, selfPid), ...orphans].map((proc) => [proc.ProcessId, proc])).values()].sort((a, b) => a.ProcessId - b.ProcessId);
}

function descendants(procs: Proc[], selfPid: number): Proc[] {
	const byId = new Map(procs.map((proc) => [proc.ProcessId, proc]));
	// フックから親をたどり、このセッションの本体を探す
	let root: Proc | undefined;
	const seen = new Set<number>();
	for (let cur = byId.get(selfPid); cur && !seen.has(cur.ProcessId); cur = byId.get(cur.ParentProcessId)) {
		seen.add(cur.ProcessId);
		if (isSessionRoot(cur)) {
			root = cur;
			break;
		}
	}
	if (!root) return [];
	const children = new Map<number, Proc[]>();
	for (const proc of procs) children.set(proc.ParentProcessId, [...(children.get(proc.ParentProcessId) ?? []), proc]);
	// 本体の子孫を順にたどる。フック自身とその子孫は数えない
	const found: Proc[] = [];
	const stack = [...(children.get(root.ProcessId) ?? [])];
	while (stack.length > 0) {
		const proc = stack.shift()!;
		if (proc.ProcessId === selfPid) continue;
		if (isWatcher(proc)) found.push(proc);
		stack.push(...(children.get(proc.ProcessId) ?? []));
	}
	return found;
}

function listProcesses(): Proc[] {
	const json = execFileSync('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'], { encoding: 'utf8', maxBuffer: 1e8, timeout: 10000 });
	return JSON.parse(json);
}

async function main(): Promise<void> {
	const input = await readInput();
	if (process.platform !== 'win32') return;
	let leftovers: Proc[];
	try {
		leftovers = findLeftovers(listProcesses(), process.pid, (input as { session_id?: string }).session_id);
	} catch {
		return;
	}
	if (leftovers.length === 0) return;

	const list = leftovers.map((proc) => `${proc.ProcessId} ${proc.Name} ${(proc.CommandLine ?? '').slice(0, 80)}`).join(' / ');
	if (input.stop_hook_active) {
		console.log(JSON.stringify({ systemMessage: stamped(`⚠️ 残っている見張りのプロセス: ${leftovers.length} 件`) }));
		return;
	}
	console.log(JSON.stringify({
		decision: 'block',
		reason: `このセッションが起こした見張りのプロセスが残っています: ${list}。用が済んでいれば止めて、止めた数を報告してください (共通ルール「短く終わるはずの作業は、見張る」)。まだ使っているなら、そう書いてください。`,
		systemMessage: stamped(`⚠️ 残っている見張りのプロセス: ${leftovers.length} 件`),
	}));
}

if (import.meta.main ?? process.argv[1]?.endsWith('check-leftover-processes.ts')) await main();
