'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.env.TURBOACC_ROOT
	? path.resolve(process.env.TURBOACC_ROOT)
	: path.resolve(__dirname, '..');

let checks = 0;
let failures = 0;

function ok(cond, label, detail) {
	checks++;

	if (!cond) {
		failures++;
		console.log('FAIL  ' + label);
		if (detail)
			console.log('      ' + String(detail).replace(/\n/g, '\n      '));
	}
}

function eq(actual, expected, label) {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);

	ok(a === e, label, a === e ? null : 'got:  ' + a + '\nwant: ' + e);
}

function summary(name) {
	const c = checks;
	const f = failures;

	console.log((f ? 'FAILED' : 'ok') + '  ' + name +
		' (' + c + ' checks, ' + f + ' failures)');

	checks = 0;
	failures = 0;

	if (f)
		process.exitCode = 1;

	return f === 0;
}

function read(rel) {
	return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function exists(rel) {
	return fs.existsSync(path.join(ROOT, rel));
}

function mode(rel) {
	return fs.statSync(path.join(ROOT, rel)).mode & 0o777;
}

function files(rel, out, prefix) {
	out = out || [];
	prefix = prefix || rel;

	for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
		const child = path.posix.join(rel, entry.name);

		if (entry.isDirectory())
			files(child, out, prefix);
		else
			out.push(path.relative(prefix, child));
	}

	return out;
}

function loadUtils() {
	const src = read('htdocs/luci-static/resources/turboacc/utils.js');
	const baseclass = {
		extend(props) {
			function C() {}
			Object.assign(C.prototype, props);
			return C;
		}
	};

	const C = new Function('baseclass', src)(baseclass);

	return new C();
}

module.exports = { ROOT, ok, eq, summary, read, exists, mode, files, loadUtils };
