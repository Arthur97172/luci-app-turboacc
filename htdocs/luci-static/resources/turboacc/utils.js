'use strict';
'require baseclass';

/*
 * Pure helpers shared by the TurboACC view. They intentionally avoid LuCI
 * globals so the test suite can load this module under plain Node.js.
 */

var ENGINES = [
	'disabled',
	'flow_offloading',
	'fast_classifier',
	'shortcut_fe_cm',
	'mediatek_hnat',
	'qca_nss_ecm'
];

function toBool(value) {
	if (value === true || value === 1)
		return true;

	if (value == null)
		return false;

	return /^(1|true|yes|on|enabled)$/i.test(String(value).trim());
}

function normalizeFastpath(value) {
	switch (value) {
	case 'flow_offloading':
	case 'fast_classifier':
	case 'shortcut_fe_cm':
	case 'mediatek_hnat':
	case 'qca_nss_ecm':
		return value;
	default:
		return 'disabled';
	}
}

/*
 * Engines offered in the dropdown. The engine currently stored in the config
 * stays selectable even when its kernel module is missing right now, so that
 * merely opening the page never rewrites the user's choice.
 */
function availableEngines(features, current) {
	var engines = (features && features.engines) || {};
	var list = [ 'disabled' ];

	if (features && features.offloading)
		list.push('flow_offloading');

	[ 'fast_classifier', 'shortcut_fe_cm', 'mediatek_hnat', 'qca_nss_ecm' ].forEach(function(name) {
		if (engines[name])
			list.push(name);
	});

	current = normalizeFastpath(current);

	if (list.indexOf(current) < 0)
		list.push(current);

	return list;
}

function sanitizeCca(value, available) {
	var list = Array.isArray(available) ? available.map(String) : [];
	var wanted = String(value || '').toLowerCase();

	if (list.indexOf(wanted) >= 0)
		return wanted;

	if (list.indexOf('cubic') >= 0)
		return 'cubic';

	return list.length ? list[0] : 'cubic';
}

return baseclass.extend({
	ENGINES: ENGINES,
	toBool: toBool,
	normalizeFastpath: normalizeFastpath,
	availableEngines: availableEngines,
	sanitizeCca: sanitizeCca
});
