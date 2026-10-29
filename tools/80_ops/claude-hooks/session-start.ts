// SessionStart フックの入口（p261027-01）。動かす処理を引数で名前を並べて選び、並べた順に呼ぶ。
//   copy     会話ログを etc/history/jsonl/ へ写す（jsonl-copy.ts）
//   obsidian Obsidian メモリを注入する（obsidian-memory.ts）
//   resume   再開・compact のとき、張り直しを促す（resume-reminder.ts）
// PC ごとの構成の違いは、settings.json の引数だけで変える。引数が無いとき・知らない名前は ⚠️ で知らせる（引数が無ければ何も動かさない）。
// 出力は JSON 1 つ。systemMessage はユーザーに見え、additionalContext は Claude のコンテキストに入る。
// additionalContext の最後に、毎回違う開始時刻の行を 1 回だけ入れる（再開で、会話にある文と同じだと Claude Code が捨てるため。jsonl-copy.ts の startLine）。
// 1 つの処理が失敗しても、ほかは続ける。セッションを止めないよう、終了コードは常に 0。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { stamped } from './jst.ts';
import { type Base, copyJsonl, reason, startLine } from './jsonl-copy.ts';
import { obsidianMemory } from './obsidian-memory.ts';
import { resumeReminder } from './resume-reminder.ts';
import { readInput } from './vault.ts';

const input = await readInput();
const messages: string[] = [];
const contexts: string[] = [];
let base: Base | null = null;

const steps: Record<string, () => void> = {
	copy: () => {
		const result = copyJsonl(input);
		base = result.base;
		if (result.message !== null) messages.push(stamped(result.message));
	},
	obsidian: () => {
		const result = obsidianMemory(input);
		messages.push(result.message);
		if (result.context) contexts.push(result.context);
	},
	resume: () => {
		const result = resumeReminder(input);
		if (!result) return;
		messages.push(stamped(result.message));
		contexts.push(result.context);
	},
};

const names = process.argv.slice(2);
if (names.length === 0) messages.push(stamped(`⚠️ SessionStart フック: 動かす処理が引数に無い（${Object.keys(steps).join('・')} から並べる）`));
for (const name of names) {
	const step = steps[name];
	if (!step) {
		messages.push(stamped(`⚠️ SessionStart フック: 知らない名前「${name}」は飛ばした（${Object.keys(steps).join('・')} から並べる）`));
		continue;
	}
	try {
		step();
	} catch (e) {
		messages.push(stamped(`❌ SessionStart フック: ${name} に失敗した: ${reason(e)}`));
	}
}

if (messages.length > 0 || contexts.length > 0) {
	contexts.push(startLine(input, base));
	console.log(JSON.stringify({
		hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: contexts.join('\n\n') },
		...(messages.length > 0 ? { systemMessage: messages.join('\n') } : {}),
	}));
}
