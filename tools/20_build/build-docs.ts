// docs/ の勉強会の読み物に、機械で決まる部分を書き込む。何度実行しても同じ結果になる。
//   <!-- AUTO:nav -->      前へ・次へ・目次のバッジ (上下 2 か所。色は行き先の資料の色)
//   <!-- AUTO:toc -->      ページ内の章の目次 (section の h1 から作る)
//   /* AUTO:style */       章の色 (章数で虹色を割る) と、章番号の数え方
//   <!-- AUTO:roadmap -->  「いまここ」の旗 (本編の全駅を並べ、このページの駅に印を付ける)
// 使い方: node tools/20_build/build-docs.ts
// 作り方の元は、学習資料の決まり (共通ルール「学習資料の作成ルール」) と、既存の学習資料の道具。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

type Doc = { file: string; num: string; title: string; lead: string };

// 色相は 280 (紫) から 0 (赤) へ、n 個を等間隔で割る。刻み = 280 ÷ (n - 1)
export function hue(i: number, n: number): number {
	if (n <= 1) return 280;
	return Math.round((280 - (280 / (n - 1)) * i) * 10) / 10;
}
export function colors(h: number): string {
	return `--accent:hsl(${h},78%,25%);--accent2:hsl(${h},58%,55%);--soft:hsl(${h},28%,95%);`;
}

function order(num: string): number {
	if (/^\d\d$/.test(num)) return Number(num);
	if (/^A\d$/.test(num)) return 100 + Number(num.slice(1));
	return 1000;
}

const ICON = {
	prev: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 2.5 4.5 8l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
	next: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2.5 11.5 8 6 13.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
	home: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.8 8 8 2.4 14.2 8M3.8 6.6v7h3.3V10h1.8v3.6h3.3v-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
};

function stripTags(s: string): string {
	return s.replace(/<[^>]+>/g, '').trim();
}
function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
function escapeAttr(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function readDoc(docsDir: string, file: string): Doc {
	const html = readFileSync(join(docsDir, file), 'utf8');
	const title = /<div class="titlebar">[\s\S]*?<h1>([\s\S]*?)<\/h1>/.exec(html);
	if (!title) throw new Error(`タイトルバーの h1 が見つかりません: ${file}`);
	const lead = /<p class="lead">([\s\S]*?)<\/p>/.exec(html);
	return { file, num: file.split('-')[0], title: stripTags(title[1]), lead: lead ? stripTags(lead[1]) : '' };
}

// 開始・終了の印の間を置き換える。印が無ければ止める。片方だけのときは、「対になっていない」と知らせる
function replaceBlock(html: string, start: string, end: string, body: string, file: string): string {
	const re = new RegExp(escapeRe(start) + '[\\s\\S]*?' + escapeRe(end), 'g');
	if (!re.test(html)) {
		if (html.includes(start) || html.includes(end)) throw new Error(`印が対になっていません: ${start} ${file}`);
		throw new Error(`${start} が見つかりません: ${file}`);
	}
	return html.replace(re, () => start + body + end);
}

// 中身が変わらないときは書かない (更新時刻だけが進むのを避ける)
function writeIfChanged(path: string, html: string): boolean {
	const old = readFileSync(path, 'utf8');
	if (old === html) return false;
	writeFileSync(path, html);
	return true;
}

// BOM 付きで読んだ文字列に BOM が混ざらないようにして、書くときに元の BOM の有無を保つ
function readKeepBom(path: string): { text: string; bom: boolean } {
	const raw = readFileSync(path, 'utf8');
	return raw.charCodeAt(0) === 0xfeff ? { text: raw.slice(1), bom: true } : { text: raw, bom: false };
}

// root の README.html の資料一覧 (<!-- AUTO:list -->)。本編と付録を、通しの色の 1 つのリストにする
export function readmeList(docsDir: string): string {
	const files = readdirSync(docsDir).filter((f) => /^(\d\d|A\d|ZZ)-.+\.html$/.test(f));
	const docs = files.map((f) => readDoc(docsDir, f)).sort((a, b) => order(a.num) - order(b.num));
	const series = docs.filter((d) => /^\d\d$/.test(d.num));
	const items = docs.map((d) => {
		const i = series.findIndex((s) => s.file === d.file);
		// 本編は通しの色。付録は、本編の終わりの色 (赤) にそろえる
		const h = i >= 0 ? hue(i, series.length) : 0;
		const lead = escapeText(d.lead);
		return `\t\t<li>\n\t\t\t<a class="doclink" href="docs/${d.file}" style="${colors(h)}">${escapeText(d.title)}</a>\n\t\t\t<p class="note">${lead}</p>\n\t\t</li>`;
	});
	return `\n\t<ul class="doclist">\n${items.join('\n')}\n\t</ul>\n\t`;
}
function escapeText(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

export function buildReadme(readmePath: string, docsDir: string): boolean {
	const { text, bom } = readKeepBom(readmePath);
	const html = replaceBlock(text, '<!-- AUTO:list -->', '<!-- /AUTO:list -->', readmeList(docsDir), 'README.html');
	return writeIfChanged(readmePath, (bom ? '﻿' : '') + html);
}

export function buildDocs(docsDir: string): { docs: number; changed: number } {
	const files = readdirSync(docsDir).filter((f) => /^(\d\d|A\d|ZZ)-.+\.html$/.test(f));
	const docs = files.map((f) => readDoc(docsDir, f)).sort((a, b) => order(a.num) - order(b.num));
	const series = docs.filter((d) => /^\d\d$/.test(d.num));
	const hueOf = new Map(series.map((d, i) => [d.file, hue(i, series.length)]));

	function link(target: Doc, label: string, icon: string): string {
		const h = hueOf.get(target.file) ?? 280;
		return `<a class="doclink" rel="${label === '前へ' ? 'prev' : 'next'}" href="${target.file}" aria-label="${label}" title="${escapeAttr(target.title)}" style="${colors(h)}">${icon}</a>`;
	}
	const home = `<a class="doclink home" href="../README.html" aria-label="目次" title="資料一覧">${ICON.home}</a>`;

	function roadmap(current: Doc): string {
		const items = series.map((d) => {
			const h = hueOf.get(d.file) ?? 280;
			const here = d.file === current.file;
			const name = escapeAttr(d.title) + (here ? ' (いまここ)' : '');
			const attrs = `class="station${here ? ' here' : ''}" href="${d.file}" title="${name}" aria-label="${name}"${here ? ' aria-current="page"' : ''}`;
			// 色だけの地は、var() を使わず直書きする (var() を含む宣言を捨てる表示でも読める)
			const c = `hsl(${h},58%,40%)`;
			return `<li><a ${attrs} style="background:${c};--st:${c};">${Number(d.num)}</a></li>`;
		});
		return `\n<nav class="roadmap" aria-label="ロードマップ"><ol>\n${items.join('\n')}\n</ol></nav>\n`;
	}

	// 全部の資料の新しい文字列を先に作る。途中で止まっても、1 本も書き換えない (通し色相が本数で変わるため、混在させない)
	const pending: { path: string; out: string }[] = [];
	for (const doc of docs) {
		const path = join(docsDir, doc.file);
		const { text, bom } = readKeepBom(path);
		let html = text;

		const links: string[] = [];
		const si = series.findIndex((d) => d.file === doc.file);
		if (si > 0) links.push(link(series[si - 1], '前へ', ICON.prev));
		if (si >= 0 && si < series.length - 1) links.push(link(series[si + 1], '次へ', ICON.next));
		links.push(home);
		html = replaceBlock(html, '<!-- AUTO:nav -->', '<!-- /AUTO:nav -->', `<p class="docnav">${links.join('')}</p>`, doc.file);

		const sections = [...html.matchAll(/<section class="(ch\d\d)" id="\1">\s*<h1>([\s\S]*?)<\/h1>/g)];
		const toc = sections.map((m) => `<li class="${m[1]}"><a href="#${m[1]}">${m[2]}</a></li>`).join('\n');
		html = replaceBlock(html, '<!-- AUTO:toc -->', '<!-- /AUTO:toc -->', `\n<nav class="toc"><ol>\n${toc}\n</ol></nav>\n`, doc.file);

		const n = sections.length;
		const css = sections.map((m, i) => `.${m[1]}{${colors(hue(i, n))}}`);
		css.push(`.toc ol{counter-reset:tocnum;} .toc ol li{counter-increment:tocnum;} .toc ol a::before{content:"${doc.num}." counter(tocnum) " ";}`);
		css.push(`body{counter-reset:secnum;} section h1{counter-increment:secnum;} section h1::before{content:"${doc.num}." counter(secnum) " ";}`);
		html = replaceBlock(html, '/* AUTO:style */', '/* /AUTO:style */', '\n' + css.join('\n') + '\n', doc.file);

		if (si >= 0) html = replaceBlock(html, '<!-- AUTO:roadmap -->', '<!-- /AUTO:roadmap -->', roadmap(doc), doc.file);

		// 本文の資料間リンクは、行き先の資料の色のバッジにする (class を書かなくても、ここで付く)
		html = html.replace(/<a (?:class="doclink ref" )?href="((?:\d\d|A\d|ZZ)-[^"#]+\.html)(#[^"]*)?"(?: style="[^"]*")?>/g, (_m, file: string, frag: string | undefined) => {
			const h = hueOf.get(file) ?? 0;
			return `<a class="doclink ref" href="${file}${frag ?? ''}" style="${colors(h)}">`;
		});

		pending.push({ path, out: (bom ? '﻿' : '') + html });
	}
	let changed = 0;
	for (const p of pending) if (writeIfChanged(p.path, p.out)) changed++;
	return { docs: docs.length, changed };
}

if (process.argv[1]?.endsWith('build-docs.ts')) {
	const docsDir = join(import.meta.dirname, '..', '..', 'docs');
	const r = buildDocs(docsDir);
	console.log(`資料 ${r.docs} 件にナビ・目次・章の色・旗を書き込みました (書き換え ${r.changed} 件)`);
	const readme = join(docsDir, '..', 'README.html');
	if (readFileSync(readme, 'utf8').includes('<!-- AUTO:list -->')) {
		console.log(`README.html の資料一覧: ${buildReadme(readme, docsDir) ? '書き換えた' : '変更なし'}`);
	}
}
