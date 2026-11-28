import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildDocs, buildReadme } from '../tools/20_build/build-docs.ts';

// 課題 i261126-01: 勉強会の読み物 (docs/NN-*.html) の約束ごと。ページが増えても崩れないようにする。
// 守るもの: タイトルの形・章の形 (chNN)・章番号を手で書かない (CSS カウンタ)・生成する部分 (AUTO:) が最新・
//   旗の駅が実在の本編と一致・SVG の id の一意と番号・各章に図・実体パスを書かない。
const root = resolve(import.meta.dirname, '..');
const docs = join(root, 'docs');
const pages = readdirSync(docs).filter((f) => /^\d\d-.*\.html$/.test(f)).sort();

const CANON = [
	'01-はじめの一歩.html', '02-慣れてきたら.html', '03-文字化けとツール.html', '04-課題と決めたことの管理.html', '05-複数プロジェクトで使う.html',
	'06-AI同士がつながる.html', '07-並べて動かす.html', '08-仕組みで守る.html', '09-画面の試験と環境の事故.html',
];

test('読み物が 1 本以上ある', () => {
	assert.ok(pages.length >= 1);
});

test('共通 CSS の background:linear-gradient の前に、色だけの地が直書きされている (グラデーションを捨てる表示でも読める)', () => {
	const css = readFileSync(join(docs, 'css/style.css'), 'utf8');
	const bad = css.split('\n').filter((l) => /background:linear-gradient\(/.test(l) && !/background:#[0-9a-f]{6};background:linear-gradient\(/.test(l));
	assert.deepEqual(bad, []);
	assert.doesNotMatch(css, /background:var\(/);
});

test('生成する部分 (nav・toc・style・roadmap) が最新である (道具を流し直しても変わらない)', () => {
	const copy = join(root, 'tmp', `docs-pages-test-${process.pid}`);
	mkdirSync(copy, { recursive: true });
	try {
		for (const f of readdirSync(docs).filter((x) => /\.html$/.test(x))) cpSync(join(docs, f), join(copy, f));
		assert.equal(buildDocs(copy).changed, 0, 'node tools/20_build/build-docs.ts を流して、結果を commit する');
	} finally {
		rmSync(copy, { recursive: true, force: true });
	}
});

test('README.html の資料一覧 (AUTO:list) が最新で、docs/ の全資料へのリンクが入っている', () => {
	const copy = join(root, 'tmp', `readme-test-${process.pid}`);
	mkdirSync(copy, { recursive: true });
	try {
		const readme = join(copy, 'README.html');
		cpSync(join(root, 'README.html'), readme);
		assert.equal(buildReadme(readme, docs), false, 'node tools/20_build/build-docs.ts を流して、結果を commit する');
		const html = readFileSync(readme, 'utf8');
		for (const f of readdirSync(docs).filter((x) => /^(\d\d|A\d|ZZ)-.+\.html$/.test(x))) {
			assert.ok(html.includes(`href="docs/${f}"`), `README に ${f} のリンクが無い`);
		}
	} finally {
		rmSync(copy, { recursive: true, force: true });
	}
});

for (const f of pages) {
	describe(f, () => {
		const html = readFileSync(join(docs, f), 'utf8').replace(/^\uFEFF/, '');
		const no = f.slice(0, 2);

		test('ファイル名は、決めた 9 本のどれか', () => {
			assert.ok(CANON.includes(f), f);
		});
		test('<title> と h1 が「NN. タイトル」で一致する', () => {
			const title = /<title>(.*?)<\/title>/.exec(html)?.[1];
			const h1 = /<div class="titlebar">[\s\S]*?<h1>(.*?)<\/h1>/.exec(html)?.[1];
			assert.ok(title && h1);
			assert.match(title, new RegExp(`^${no}\\. `));
			assert.equal(title, h1);
		});
		test('章は <section class="chNN" id="chNN"> で、NN が 01 から続く', () => {
			const ids = [...html.matchAll(/<section class="(ch\d\d)" id="(ch\d\d)">/g)];
			assert.ok(ids.length >= 1);
			ids.forEach((m, i) => {
				assert.equal(m[1], m[2]);
				assert.equal(m[1], `ch${String(i + 1).padStart(2, '0')}`);
			});
			assert.equal(ids.length, (html.match(/<section\b/g) ?? []).length, 'section が章の形でないものがある');
		});
		test('章の見出し (h1) に、番号を手で書かない (番号は CSS カウンタが付ける)', () => {
			for (const m of html.matchAll(/<section class="ch\d\d" id="ch\d\d">\s*<h1>(.*?)<\/h1>/g)) {
				assert.doesNotMatch(m[1], /^\d+(\.\d+)?[.\s]/, m[1]);
			}
		});
		test('章の色は、body に stNN を付けず、AUTO:style で章ごとに決まる', () => {
			assert.doesNotMatch(html, /<body class=/);
			assert.match(html, /\/\* AUTO:style \*\/[\s\S]*\.ch01\{--accent:/);
		});
		test('AUTO:nav が上下に 2 つあり、同じ内容 (前へ・次へ・目次のバッジ)', () => {
			const navs = [...html.matchAll(/<!-- AUTO:nav -->([\s\S]*?)<!-- \/AUTO:nav -->/g)].map((m) => m[1]);
			assert.equal(navs.length, 2);
			assert.equal(navs[0], navs[1]);
			assert.match(navs[0], /class="doclink home" href="\.\.\/README\.html"/);
		});
		test('旗 (roadmap) の駅は、実在する本編の全部で、いまここが自分だけ', () => {
			const nav = /<!-- AUTO:roadmap -->([\s\S]*?)<!-- \/AUTO:roadmap -->/.exec(html)?.[1] ?? '';
			const st = [...nav.matchAll(/<a class="station( here)?" href="(.*?)"/g)];
			assert.deepEqual(st.map((m) => m[2]), pages);
			const here = st.filter((m) => m[1]);
			assert.equal(here.length, 1);
			assert.equal(here[0][2], f);
		});
		test('SVG の id は、ページの中で一意で、参照 (url(#…)) が全部ある', () => {
			const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
			assert.equal(new Set(ids).size, ids.length, '重複: ' + ids.filter((x, i) => ids.indexOf(x) !== i).join(','));
			for (const m of html.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(m[1]), '参照先が無い: ' + m[1]);
		});
		test('SVG の id に、ファイルの番号が入っている (他の資料のコピーの取り違えを防ぐ)', () => {
			for (const m of html.matchAll(/<(?:linearGradient|marker) id="([a-z]+-\d\d-[^"]+)"/g)) {
				assert.match(m[1], new RegExp(`^[a-z]+-${no}-`), m[1]);
			}
		});
		test('SVG の箱 (rect) は、下が暗く上が明るいグラデーション。単色は白 (紙・枠) だけ', () => {
			for (const m of html.matchAll(/<rect\b[^>]*\bfill="(#[0-9a-fA-F]+)"/g)) {
				assert.ok(['#fff', '#ffffff'].includes(m[1].toLowerCase()), `単色の箱: ${m[0].slice(0, 90)}`);
			}
			for (const m of html.matchAll(/<linearGradient id="([^"]+)"([^>]*)>/g)) {
				assert.match(m[2], /x1="0" y1="1" x2="0" y2="0"/, `${m[1]}: 下から上に明るくなる向きにする`);
			}
		});
		test('章 (section) のどれにも図 (figure) がある', () => {
			const sections = html.split(/<section\b/).slice(1);
			assert.ok(sections.length >= 1);
			for (const s of sections) assert.match(s, /<figure>/, s.slice(0, 80));
		});
		test('本文の資料間リンクは、色付きのバッジ (class="doclink ref" と、行き先の色)', () => {
			const body = html.replace(/<!-- AUTO:nav -->[\s\S]*?<!-- \/AUTO:nav -->/g, '').replace(/<!-- AUTO:roadmap -->[\s\S]*?<!-- \/AUTO:roadmap -->/, '');
			for (const m of body.matchAll(/<a ([^>]*href="(?:\d\d|A\d|ZZ)-[^"]+\.html[^"]*"[^>]*)>/g)) {
				assert.match(m[1], /^class="doclink ref" href=/, m[0]);
				assert.match(m[1], /style="--accent:hsl\(/, m[0]);
			}
		});
		test('実体パス (C:\\Users など) を書かない', () => {
			assert.doesNotMatch(html, /C:[\\/]+Users/i);
		});
	});
}
