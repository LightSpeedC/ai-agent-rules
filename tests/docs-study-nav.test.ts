import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';

// 課題 i261126-01: 勉強会の読み物 (docs/) の共通 JS。矢印キーで前へ・次へ進む。
// 守る動き: → で次、← で前、入力欄では動かない、修飾キー付きでは動かない、前・次が無いページでは動かない。
// 旗 (いまここ) と目次は静的な HTML/CSS で、JS が無効でも読める。この JS は、読みやすさを足すだけ。
const root = resolve(import.meta.dirname, '..');
const src = readFileSync(join(root, 'docs/js/study-nav.js'), 'utf8');

type Api = { keyTarget: (e: Record<string, unknown>, links: { prev?: string; next?: string }) => string | null; init: (doc: unknown, loc: { href: string }) => void };

function load(): Api {
	const sandbox: Record<string, unknown> = { window: {} };
	vm.createContext(sandbox);
	vm.runInContext(src, sandbox);
	return (sandbox.window as { StudyNav: Api }).StudyNav;
}

describe('keyTarget (キーから行き先を決める)', () => {
	const links = { prev: '01-a.html', next: '03-c.html' };
	test('→ で次へ', () => {
		assert.equal(load().keyTarget({ key: 'ArrowRight' }, links), '03-c.html');
	});
	test('← で前へ', () => {
		assert.equal(load().keyTarget({ key: 'ArrowLeft' }, links), '01-a.html');
	});
	test('前が無いページで ← は動かない', () => {
		assert.equal(load().keyTarget({ key: 'ArrowLeft' }, { next: '02-b.html' }), null);
	});
	test('次が無いページで → は動かない', () => {
		assert.equal(load().keyTarget({ key: 'ArrowRight' }, { prev: '08-h.html' }), null);
	});
	test('ほかのキーでは動かない', () => {
		assert.equal(load().keyTarget({ key: 'a' }, links), null);
		assert.equal(load().keyTarget({ key: 'ArrowDown' }, links), null);
	});
	test('Ctrl・Alt・Meta・Shift 付きでは動かない (ブラウザの戻る・進むを奪わない)', () => {
		for (const m of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey']) {
			assert.equal(load().keyTarget({ key: 'ArrowRight', [m]: true }, links), null, m);
		}
	});
	test('入力欄・選択・編集可能な場所では動かない', () => {
		for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
			assert.equal(load().keyTarget({ key: 'ArrowRight', target: { tagName: tag } }, links), null, tag);
		}
		assert.equal(load().keyTarget({ key: 'ArrowRight', target: { tagName: 'DIV', isContentEditable: true } }, links), null);
	});
});

describe('keyTarget (ほかの処理と衝突しない)', () => {
	const links = { prev: '01-a.html', next: '03-c.html' };
	test('ほかの処理が済んだキー (defaultPrevented) では動かない', () => {
		assert.equal(load().keyTarget({ key: 'ArrowRight', defaultPrevented: true }, links), null);
	});
	test('長押し (repeat) では動かない (連続で遷移しない)', () => {
		assert.equal(load().keyTarget({ key: 'ArrowRight', repeat: true }, links), null);
	});
	test('IME の変換中 (isComposing) では動かない', () => {
		assert.equal(load().keyTarget({ key: 'ArrowRight', isComposing: true }, links), null);
	});
	test('横にスクロールできる pre の中では動かない (スクロールを奪わない)', () => {
		const pre = { tagName: 'PRE', scrollWidth: 500, clientWidth: 200, parentElement: null };
		const code = { tagName: 'CODE', scrollWidth: 500, clientWidth: 500, parentElement: pre };
		assert.equal(load().keyTarget({ key: 'ArrowRight', target: code }, links), null);
	});
	test('横にスクロールできる表の枠 (tablewrap) の中では動かない', () => {
		const wrap = { tagName: 'DIV', className: 'tablewrap x', scrollWidth: 900, clientWidth: 300, parentElement: null };
		const td = { tagName: 'TD', scrollWidth: 100, clientWidth: 100, parentElement: wrap };
		assert.equal(load().keyTarget({ key: 'ArrowLeft', target: td }, links), null);
	});
	test('スクロールが要らない pre の中では、動く', () => {
		const pre = { tagName: 'PRE', scrollWidth: 200, clientWidth: 200, parentElement: null };
		assert.equal(load().keyTarget({ key: 'ArrowRight', target: pre }, links), '03-c.html');
	});
});

describe('init (ページに結びつける)', () => {
	function fakeDoc(prev?: string, next?: string) {
		const handlers: Record<string, (e: Record<string, unknown>) => void> = {};
		return {
			handlers,
			querySelector(sel: string) {
				if (sel === 'a[rel~="prev"]' && prev) return { getAttribute: () => prev };
				if (sel === 'a[rel~="next"]' && next) return { getAttribute: () => next };
				return null;
			},
			addEventListener(type: string, fn: (e: Record<string, unknown>) => void) { handlers[type] = fn; },
		};
	}
	test('→ で loc.href が次の資料になる', () => {
		const doc = fakeDoc('01-a.html', '03-c.html');
		const loc = { href: '02-b.html' };
		load().init(doc, loc);
		doc.handlers.keydown({ key: 'ArrowRight', preventDefault() {} });
		assert.equal(loc.href, '03-c.html');
	});
	test('← で loc.href が前の資料になり、preventDefault を呼ぶ', () => {
		const doc = fakeDoc('01-a.html', '03-c.html');
		const loc = { href: '02-b.html' };
		let prevented = false;
		load().init(doc, loc);
		doc.handlers.keydown({ key: 'ArrowLeft', preventDefault() { prevented = true; } });
		assert.equal(loc.href, '01-a.html');
		assert.equal(prevented, true);
	});
	test('前後の無いページでは href が変わらない', () => {
		const doc = fakeDoc();
		const loc = { href: 'x.html' };
		load().init(doc, loc);
		doc.handlers.keydown({ key: 'ArrowRight', preventDefault() {} });
		assert.equal(loc.href, 'x.html');
	});
});
