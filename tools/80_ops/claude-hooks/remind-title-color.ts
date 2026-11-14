// UserPromptSubmit フック: 発言を受けるたびに、セッションのタイトルの状態の色を付け替えるよう 1 行で促す (課題 i261114-01、決定 422-A)。
// 共通ルール「セッションのタイトルに状態の色を付ける」の文だけでは、状態の変わり目で付け替えを忘れやすい。
// 色を付けるのは AI が呼ぶ set_session_title で、フックからは付けられない。止めずに促すだけにする。
// 入力が読めないとき・prompt が無いときは何も出さない。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { argv } from 'node:process';

export const CONTEXT =
	'タイトルの状態の色: 作業に入るなら🟢、利用者の答え待ちで終えるなら🔴、別のセッションの結果待ちなら🟡、計画・調査なら🟠、課題なしの待機なら🔵に、' +
	'set_session_title (session_id は self) で左端の 1 字だけを付け替える。今の色のままでよければ呼ばない (共通ルール「セッションのタイトルに状態の色を付ける」)。';

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const c of process.stdin) chunks.push(c as Buffer);
	return Buffer.concat(chunks).toString('utf8');
}

const isMain = (import.meta as { main?: boolean }).main ?? (argv[1] ?? '').replaceAll('\\', '/').endsWith('remind-title-color.ts');
if (isMain) {
	let input: { prompt?: unknown };
	try {
		input = JSON.parse(await readStdin());
	} catch {
		process.exit(0);
	}
	if (typeof input?.prompt === 'string') {
		process.stdout.write(JSON.stringify({
			hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: CONTEXT },
		}));
	}
}
