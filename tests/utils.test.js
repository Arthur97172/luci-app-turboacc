'use strict';

const { ok, eq, summary, loadUtils } = require('./lib');

const utils = loadUtils();

eq(utils.toBool(true), true, 'toBool(true)');
eq(utils.toBool(1), true, 'toBool(1)');
eq(utils.toBool('1'), true, 'toBool("1")');
eq(utils.toBool('yes'), true, 'toBool("yes")');
eq(utils.toBool('Enabled'), true, 'toBool("Enabled")');
eq(utils.toBool('0'), false, 'toBool("0")');
eq(utils.toBool(''), false, 'toBool("")');
eq(utils.toBool(null), false, 'toBool(null)');

eq(utils.normalizeFastpath('none'), 'disabled', 'legacy "none" maps to disabled');
eq(utils.normalizeFastpath(''), 'disabled', 'empty maps to disabled');
eq(utils.normalizeFastpath('bogus'), 'disabled', 'unknown maps to disabled');

for (const engine of utils.ENGINES) {
	if (engine === 'disabled')
		continue;

	eq(utils.normalizeFastpath(engine), engine, 'keeps engine ' + engine);
}

eq(
	utils.availableEngines({
		offloading: true,
		engines: { fast_classifier: false, shortcut_fe_cm: false, mediatek_hnat: true, qca_nss_ecm: false }
	}, 'disabled'),
	[ 'disabled', 'flow_offloading', 'mediatek_hnat' ],
	'availableEngines filters unsupported engines'
);

eq(
	utils.availableEngines({ offloading: false, engines: {} }, 'disabled'),
	[ 'disabled' ],
	'availableEngines on a stock system'
);

eq(
	utils.availableEngines({ offloading: false, engines: {} }, 'shortcut_fe_cm'),
	[ 'disabled', 'shortcut_fe_cm' ],
	'keeps a configured but currently unavailable engine selectable'
);

eq(
	utils.availableEngines({}, 'none'),
	[ 'disabled' ],
	'availableEngines tolerates a missing features object'
);

eq(utils.sanitizeCca('BBR', [ 'cubic', 'bbr' ]), 'bbr', 'sanitizeCca lowercases and accepts');
eq(utils.sanitizeCca('westwood', [ 'cubic', 'bbr' ]), 'cubic', 'sanitizeCca falls back to cubic');
eq(utils.sanitizeCca('westwood', [ 'reno', 'bbr' ]), 'reno', 'sanitizeCca falls back to first');
eq(utils.sanitizeCca(null, []), 'cubic', 'sanitizeCca with no list');
eq(utils.sanitizeCca(undefined, undefined), 'cubic', 'sanitizeCca with no arguments');

summary('utils.test.js');
