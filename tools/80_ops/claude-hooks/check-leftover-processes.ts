// Stop フック: このセッションが起こした tail・grep・見張りの powershell が残っていれば知らせる (課題 i261111-06、ai-agent-tools の依頼 #1923)。
// 共通ルール「短く終わるはずの作業は、見張る」の後始末 (見張りのプロセスを止める) を機械的に確かめる。
// このセッションの本体は、フックから親をたどって最初に当たる claude-code の claude.exe。その子孫だけを見る (別のセッションの分には触れない)。
// プロセスの親子は CIM (Get-CimInstance Win32_Process) で取る。psls には機械が読める出力が無いため。
// 止めるのは 1 回まで。stop_hook_active が true なら止めずに知らせるだけ。Windows 以外と、取れなかったときは何もしない。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stamped } from './jst.ts';
import { readInput } from './vault.ts';

// Created は起きた時刻 (UTC のエポックからのミリ秒)。取れなければ無い
export type Proc = { ProcessId: number; ParentProcessId: number; Name: string; CommandLine: string | null; Created?: number };

const WATCH_NAMES = /^(tail|grep)(\.exe)?$/i;
const TAIL_NAME = /^tail(\.exe)?$/i;
const GREP_NAME = /^grep(\.exe)?$/i;
// 見張りの grep は、tail -f の出力をすぐ流すために --line-buffered を付ける。付かない grep (パイプの途中の使い捨て) は拾わない (決定 425-A、課題 i261114-04)。
// 11/14 に、別のセッションの grep -E "…" を 2 回拾った
const GREP_WATCH = /--line-buffered/;
// 見張りの tail は -f・-F・--follow を付ける。付かない tail (パイプの途中の tail -1 等) は拾わない (11/14 に別のセッションの分を拾った)
const TAIL_FOLLOW = /(^|\s)(-[a-zA-Z]*[fF][a-zA-Z]*|--follow\S*)(\s|$)/;
const SHELL_NAMES = /^(powershell|pwsh)(\.exe)?$/i;
const WATCH_SHELL = /-Wait\b|-Tail\b|\bwhile\b|Start-Sleep/i;

function isSessionRoot(proc: Proc): boolean {
	return /^claude(\.exe)?$/i.test(proc.Name) && /claude-code/i.test(proc.CommandLine ?? '');
}

function isWatcher(proc: Proc): boolean {
	if (TAIL_NAME.test(proc.Name)) return TAIL_FOLLOW.test(proc.CommandLine ?? '');
	if (GREP_NAME.test(proc.Name)) return GREP_WATCH.test(proc.CommandLine ?? '');
	return WATCH_NAMES.test(proc.Name) ||(SHELL_NAMES.test(proc.Name) && WATCH_SHELL.test(proc.CommandLine ?? ''));
}

// sessionId を渡すと、親のいない孤児でも、コマンド行にその ID がある見張りを拾う。
// Git Bash で背面に回すと、間の bash が先に終わり、残った tail は本体からたどれなくなる (11/11 に実測)
export function findLeftovers(procs: Proc[], selfPid: number, sessionId?: string): Proc[] {
	const orphans = sessionId ? procs.filter((proc) => isWatcher(proc) && (proc.CommandLine ?? '').includes(sessionId)) : [];
	return [...new Map([...descendants(procs, selfPid), ...orphans].map((proc) => [proc.ProcessId, proc])).values()].sort((a, b) => a.ProcessId - b.ProcessId);
}

// フックから親をたどり、このセッションの本体を探す
function sessionRoot(procs: Proc[], selfPid: number): Proc | undefined {
	const byId = new Map(procs.map((proc) => [proc.ProcessId, proc]));
	const seen = new Set<number>();
	for (let cur = byId.get(selfPid); cur && !seen.has(cur.ProcessId); cur = byId.get(cur.ParentProcessId)) {
		seen.add(cur.ProcessId);
		if (isSessionRoot(cur)) return cur;
	}
	return undefined;
}

// 親のいない見張りのうち、このセッションの本体より後に起きたものを返す (決定 421-A)。
// 背面の tail のコマンド行にセッション ID が無いと、findLeftovers では拾えない (#1940)。
// 別のセッションの分が混ざりうるので、止めさせずに「確かめてから止める」と知らせるのに使う。findLeftovers で拾うものは除く
export function findSuspects(procs: Proc[], selfPid: number, sessionId?: string): Proc[] {
	const root = sessionRoot(procs, selfPid);
	if (!root || root.Created === undefined) return [];
	const ids = new Set(procs.map((proc) => proc.ProcessId));
	const certain = new Set(findLeftovers(procs, selfPid, sessionId).map((proc) => proc.ProcessId));
	return procs
		.filter((proc) => isWatcher(proc) && !ids.has(proc.ParentProcessId) && !certain.has(proc.ProcessId))
		.filter((proc) => proc.Created !== undefined && proc.Created >= root.Created!)
		.sort((a, b) => a.ProcessId - b.ProcessId);
}

function descendants(procs: Proc[], selfPid: number): Proc[] {
	const root = sessionRoot(procs, selfPid);
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
	const created = "@{n='Created';e={[int64](($_.CreationDate.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds)}}";
	const json = execFileSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,${created} | ConvertTo-Json -Compress`], { encoding: 'utf8', maxBuffer: 1e8, timeout: 10000 });
	return JSON.parse(json);
}

// かもしれない孤児は、同じプロセスを 2 度知らせない。印はセッションごとに一時フォルダへ置く (CLAUDE_LEFTOVER_MARK_DIR で差し替えられる)
function newSuspects(suspects: Proc[], sessionId: string | undefined): Proc[] {
	if (suspects.length === 0) return [];
	const file = join(process.env.CLAUDE_LEFTOVER_MARK_DIR || join(tmpdir(), 'claude-leftover-marks'), (sessionId || 'unknown') + '.txt');
	let seen = new Set<string>();
	try {
		seen = new Set(readFileSync(file, 'utf8').split(/\r?\n/));
	} catch {
		// 初めて
	}
	const fresh = suspects.filter((proc) => !seen.has(`${proc.ProcessId}@${proc.Created}`));
	try {
		mkdirSync(dirname(file), { recursive: true });
		appendFileSync(file, fresh.map((proc) => `${proc.ProcessId}@${proc.Created}\n`).join(''));
	} catch {
		// 印を置けないだけ
	}
	return fresh;
}

const show = (procs: Proc[]) => procs.map((proc) => `${proc.ProcessId} ${proc.Name} ${(proc.CommandLine ?? '').slice(0, 80)}`).join(' / ');

async function main(): Promise<void> {
	const input = await readInput();
	if (process.platform !== 'win32') return;
	const sessionId = (input as { session_id?: string }).session_id;
	let leftovers: Proc[];
	let suspects: Proc[];
	try {
		const procs = listProcesses();
		leftovers = findLeftovers(procs, process.pid, sessionId);
		suspects = findSuspects(procs, process.pid, sessionId);
	} catch {
		return;
	}
	if (input.stop_hook_active) {
		if (leftovers.length > 0) console.log(JSON.stringify({ systemMessage: stamped(`⚠️ 残っている見張りのプロセス: ${leftovers.length} 件`) }));
		return;
	}
	suspects = newSuspects(suspects, sessionId);
	if (leftovers.length === 0 && suspects.length === 0) return;

	const parts: string[] = [];
	if (leftovers.length > 0) parts.push(`このセッションが起こした見張りのプロセスが残っています: ${show(leftovers)}。用が済んでいれば止めて、止めた数を報告してください。まだ使っているなら、そう書いてください。`);
	if (suspects.length > 0) parts.push(`このセッションが始まった後に起きた、親のいない見張りのプロセスがあります (別のセッションのものかもしれません): ${show(suspects)}。自分が起こしたものか確かめ、そうなら止めて報告してください。別のセッションのものなら触らないでください。`);
	console.log(JSON.stringify({
		decision: 'block',
		reason: parts.join(' ') + ' (共通ルール「短く終わるはずの作業は、見張る」)',
		systemMessage: stamped(`⚠️ 残っている見張りのプロセス: ${leftovers.length} 件、かもしれないもの: ${suspects.length} 件`),
	}));
}

if (import.meta.main ?? process.argv[1]?.endsWith('check-leftover-processes.ts')) await main();
