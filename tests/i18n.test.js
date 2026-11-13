'use strict';

const { ok, eq, summary, read } = require('./lib');

/*
 * Minimal PO reader. Every entry this package ships is a single-line msgid /
 * msgstr pair, so a line scanner is enough and keeps the tests dependency
 * free. Multi-line header entries are collected the same way gettext writes
 * them.
 */

function parsePo(text) {
	const entries = [];
	let current = null;
	let field = null;

	for (const line of text.split('\n')) {
		if (line === '')
			continue;

		if (line.startsWith('#')) {
			if (line.startsWith('#,') && line.includes('fuzzy') && current)
				current.fuzzy = true;
			continue;
		}

		let match = line.match(/^(msgid|msgctxt|msgstr)\s+"(.*)"$/);

		if (match) {
			field = match[1];

			if (field === 'msgid') {
				current = { msgid: match[2], msgstr: '', fuzzy: false };
				entries.push(current);
			}
			else if (field === 'msgctxt' && current) {
				current.msgctxt = match[2];
			}
			else if (field === 'msgstr' && current) {
				current.msgstr = match[2];
			}

			continue;
		}

		match = line.match(/^"(.*)"$/);

		if (match && current) {
			if (field === 'msgid')
				current.msgid += match[1];
			else if (field === 'msgstr')
				current.msgstr += match[1];
		}
	}

	return entries;
}

const pot = parsePo(read('po/templates/turboacc.pot'));
const po = parsePo(read('po/zh_Hans/turboacc.po'));

const header = pot.find(entry => entry.msgid === '');

ok(header != null, 'template has a PO header');
ok(/charset=UTF-8/.test(header ? header.msgstr : ''), 'template declares UTF-8');

const messages = pot.filter(entry => entry.msgid !== '');
const ids = messages.map(entry => entry.msgid);

eq(ids.length, new Set(ids).size, 'template has no duplicate msgids');

for (const entry of messages)
	ok(!entry.fuzzy, 'template entry is not fuzzy: ' + entry.msgid);

/* Every user visible string in the view must be extractable. */

const view = read('htdocs/luci-static/resources/view/turboacc.js');
const literals = [];

for (const match of view.matchAll(/_\(\s*'([^']*)'\s*\)/g))
	literals.push(match[1]);

const missing = literals.filter(text => !ids.includes(text));

eq(missing, [], 'every _() string in the view is in the template');

const concatenated = view.match(/_\([^)]*\+[^)]*\)/g) || [];

eq(concatenated, [], 'no translated string is built by concatenation');

/* The Chinese catalog must cover the template completely. */

const zhIds = po.filter(entry => entry.msgid !== '').map(entry => entry.msgid);

eq(zhIds.slice().sort(), ids.slice().sort(), 'zh_Hans covers exactly the template');

for (const entry of po) {
	if (entry.msgid === '')
		continue;

	ok(!entry.fuzzy, 'zh_Hans entry is not fuzzy: ' + entry.msgid);
	ok(entry.msgstr.trim() !== '', 'zh_Hans translates: ' + entry.msgid);
}

const zhHeader = po.find(entry => entry.msgid === '');

ok(/charset=UTF-8/.test(zhHeader ? zhHeader.msgstr : ''), 'zh_Hans declares UTF-8');
ok(/Language: zh_Hans/.test(zhHeader ? zhHeader.msgstr : ''), 'zh_Hans declares its language');

/* Spot check the terminology, and make sure the file really is Chinese. */

const byId = Object.fromEntries(po.map(entry => [ entry.msgid, entry.msgstr ]));
const cjk = /\p{Script=Han}/u;

eq(byId['Acceleration engine'], '加速引擎', 'engine label is translated');
eq(byId['TurboACC'], 'TurboACC加速', 'the application name is localised');
eq(byId['Flow offloading'], '流量卸载', 'flow offloading keeps its standard term');
eq(byId['Disabled'], '已禁用', 'disabled state is translated');

let han = 0;

for (const entry of po) {
	if (entry.msgid !== '' && cjk.test(entry.msgstr))
		han++;
}

ok(han >= messages.length * 0.9, 'nearly every zh_Hans message contains Chinese text',
	han + ' of ' + messages.length);

/* zh_Hans must keep placeholders and formatting intact. */

for (const entry of po) {
	const placeholders = (entry.msgid.match(/%[sdJ%]/g) || []).sort();

	if (!placeholders.length)
		continue;

	const translated = (entry.msgstr.match(/%[sdJ%]/g) || []).sort();

	eq(translated, placeholders, 'placeholders preserved: ' + entry.msgid);
}

summary('i18n.test.js');
