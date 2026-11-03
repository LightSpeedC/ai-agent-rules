// UserPromptSubmit フック: 作業を止める指示を受けたとき、cron を消すよう思い出させる (課題 i261103-01)。
// 利用者が止めるよう言っても cron が残り、点検が動き続けた (20261019-file-manager の振り返り 460)。
// 元は 20261019-file-manager のサンプル (#1758)。
//
// 語の判定はサンプルのまま (10-A): 止めて ・ 止める ・ 中断 ・ ストップ ・ 区切りで止。
//   「止めてよい」「止めても構わない」等の許可の言い回しは、先に取り除いてから判定する。
// 語だけで当たるため、cron と関係の無いもの (「親プロセスは止めて」) や、止めることの説明にも当たる。
//   差し込む文で、作業全体を止める指示かを読ませる。特定のものを止める指示なら消さない。
// 入力が読めないとき・prompt が無いときは何も出さない。

import { argv } from 'node:process';

const HALT_WORDS = /止めて|止める|中断|ストップ|区切りで止/;
const PERMISSION_PHRASES = /止めてよ|止めても|止めていい|止めてもい/g;

export function isHalt(prompt: string): boolean {
	return HALT_WORDS.test(prompt.replace(PERMISSION_PHRASES, ''));
}

export const CONTEXT =
	'利用者の発言に「止める」意味の語がある。作業全体を止める指示なら、CronList で張っている cron を確かめ、' +
	'CronDelete で消す (点検が動き続けないようにする)。再び張るのは、利用者が再開を指示してから。' +
	'プロセスなど特定のものを止める指示・止めることの説明なら、cron は消さない。';

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const c of process.stdin) chunks.push(c as Buffer);
	return Buffer.concat(chunks).toString('utf8');
}

const isMain = (import.meta as { main?: boolean }).main ?? (argv[1] ?? '').replaceAll('\\', '/').endsWith('stop-cron-on-halt.ts');
if (isMain) {
	let input: { prompt?: unknown };
	try {
		input = JSON.parse(await readStdin());
	} catch {
		process.exit(0);
	}
	if (typeof input?.prompt === 'string' && isHalt(input.prompt)) {
		process.stdout.write(JSON.stringify({
			hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: CONTEXT },
		}));
	}
}
