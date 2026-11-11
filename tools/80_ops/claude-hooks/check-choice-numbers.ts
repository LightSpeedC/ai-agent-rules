// Stop フック: 応答に書いた選択肢の番号 (NNN-A) が、issue choice next の予約に無ければ知らせる (課題 i261111-05、ai-agent-tools の依頼 #1923)。
// 共通ルール「複数の解決案がある場合の対応」の「番号を issue choice next で取る」を機械的に確かめる。
// 予約の置き場は <numbers>/uuid_<uuid>_<名前>/choices/<番号>/ (既定の <numbers> は ~/.ai-agent-tools/numbers。試験では AI_AGENT_TOOLS_NUMBERS_DIR で変える)。
// 決定 (notes/40_issues/decisions/) に出てくる番号も、使ってよい番号として数える (前に決めた番号を引くことがあるため)。
// 止めるのは 1 回まで。stop_hook_active が true なら止めずに知らせるだけ。issue を使っていないプロジェクトでは何もしない。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stamped } from './jst.ts';
import { lastTurnTexts } from './japanese-check.ts';
import { readInput } from './vault.ts';

// コードの部分 (コードブロック・コードスパン) は番号を拾わない
const CODE = [/^ {0,3}```.*$[\s\S]*?(^ {0,3}```[ \t]*$|(?![\s\S]))/gm, /`[^`\n]*`/g];
// 前後が英数字・ハイフンでない NNN-A。課題の番号 (i261110-0r) や日付 (2026-11-11) は当たらない
const CHOICE = /(?<![\w-])(\d{1,4})-[A-Z](?![\w-])/g;

export function choiceNumbers(text: string): string[] {
	let prose = text;
	for (const part of CODE) prose = prose.replace(part, ' ');
	return [...new Set([...prose.matchAll(CHOICE)].map((m) => m[1]))];
}

function readText(path: string): string {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return '';
	}
}

function listDir(path: string): string[] {
	try {
		return readdirSync(path);
	} catch {
		return [];
	}
}

// 使ってよい番号: 予約した番号と、決定に出てくる番号
function knownNumbers(projectDir: string, uuid: string): Set<string> {
	const known = new Set<string>();
	const top = process.env.AI_AGENT_TOOLS_NUMBERS_DIR ?? join(homedir(), '.ai-agent-tools', 'numbers');
	for (const dir of listDir(top).filter((name) => name.startsWith(`uuid_${uuid}_`))) {
		for (const n of listDir(join(top, dir, 'choices'))) known.add(n);
	}
	const decisions = join(projectDir, 'notes/40_issues/decisions');
	for (const file of listDir(decisions).filter((name) => name.endsWith('.md'))) {
		for (const m of readText(join(decisions, file)).matchAll(/(\d{1,4})-[A-Z]/g)) known.add(m[1]);
		for (const m of readText(join(decisions, file)).matchAll(/^title: *(\d{1,4}):/gm)) known.add(m[1]);
	}
	return known;
}

async function main(): Promise<void> {
	const input = await readInput();
	const cwd = (input as { cwd?: string }).cwd;
	if (!input.transcript_path || !cwd) return;
	const uuid = readText(join(cwd, 'notes/40_issues/items/project-uuid.txt')).match(/^project_uuid: *(\w+)/m)?.[1];
	if (!uuid) return;

	const texts = lastTurnTexts(readText(input.transcript_path));
	const used = [...new Set(texts.flatMap(choiceNumbers))];
	if (used.length === 0) return;
	const known = knownNumbers(cwd, uuid);
	const unknown = used.filter((n) => !known.has(n));
	if (unknown.length === 0) return;

	const list = unknown.join('・');
	if (input.stop_hook_active) {
		console.log(JSON.stringify({ systemMessage: stamped(`⚠️ 予約に無い選択肢の番号: ${list}`) }));
		return;
	}
	console.log(JSON.stringify({
		decision: 'block',
		reason: `選択肢の番号 ${list} は、issue choice next の予約にも決定にもありません。issue choice next で番号を取り、その番号に振り直してください (共通ルール「複数の解決案がある場合の対応」)。前に決めた番号を引いただけなら、そう書いてください。`,
		systemMessage: stamped(`⚠️ 予約に無い選択肢の番号: ${list}`),
	}));
}

if (import.meta.main ?? process.argv[1]?.endsWith('check-choice-numbers.ts')) await main();
