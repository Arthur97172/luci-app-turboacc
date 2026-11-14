'use strict';

const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { ok, summary, read } = require('./lib');

const core = read('root/usr/share/ucode/turboacc/core.uc');
const main = read('root/usr/share/ucode/turboacc/main.uc');
const plugin = read('root/usr/share/rpcd/ucode/luci.turboacc');
const init = read('root/etc/init.d/turboacc');
const defaults = read('root/etc/uci-defaults/90-turboacc');

/* --- module structure ----------------------------------------------------- */

ok(/^'use strict';$/m.test(core), 'core is strict');
ok(core.includes('SPDX-License-Identifier: GPL-3.0-only'), 'core carries a license header');
ok(/import \* as fs from 'fs';/.test(core), 'core imports the fs module');
ok(/import \* as uci from 'uci';/.test(core), 'core imports the uci module');

for (const name of [ 'detect', 'status', 'apply', 'stop', 'defaults' ])
	ok(new RegExp('^function ' + name + '\\(', 'm').test(core), 'core defines ' + name + '()');

/*
 * Imported .uc files are compiled as ES modules by ucode: top-level `return`
 * is only legal for the rpcd plugin, so the shared core must export, and this
 * ucode generation only accepts a single `export { ... };` statement.
 */
ok(!/^return\s/m.test(core), 'core has no top-level return (it is imported as a module)');

const exportList = core.match(/^export \{([^}]*)\};$/m);

ok(exportList != null, 'core exports through a single export list');

const exported = exportList ? exportList[1].split(',').map(name => name.trim()) : [];

for (const name of [ 'detect', 'status', 'apply', 'stop', 'defaults' ])
	ok(exported.includes(name), 'core exports ' + name);

ok(!/firewall3|\bfw3\b|iptables|ip6tables|xt_FLOWOFFLOAD/.test(core),
	'backend has no firewall3 residue');
ok(core.includes('/usr/share/ucode/fw4.uc'), 'capabilities are probed from fw4 itself');
ok(core.includes('/var/run/fw4.state'), 'firewall reload is skipped when fw4 is not running');
ok(/flow_offloading_hw_ipv6/.test(core), 'IPv6 hardware offload is handled when fw4 supports it');
ok(/fullcone6/.test(core), 'IPv6 full-cone is handled when fw4 supports it');
ok(/add chain inet turboacc_probe/.test(core), 'full-cone support is verified with an nft dry run');
ok(core.includes("st.type == 'directory'"),
	'loaded modules are recognised through the fs.stat directory type');

/*
 * /proc/device-tree/compatible is NUL-separated and the board entry normally
 * comes first (e.g. "gemtek,w1700k-ubi" before "airoha,an7581"). Matching the
 * whole buffer stops at the first NUL and misses the SoC entry, so every
 * compatible string has to be tested on its own.
 */
ok(/split\(compat, "\\0"\)/.test(core),
	'hardware detection splits the NUL-separated compatible list');
ok(!/match\(compat, HW_COMPAT\)/.test(core),
	'hardware detection does not match the whole compatible buffer');

const hwCompat = core.match(/^const HW_COMPAT = (\/.*\/);$/m);

if (hwCompat) {
	const compat = 'gemtek,w1700k-ubi\0airoha,an7581\0airoha,en7581\0';
	const entries = compat.split('\0');
	const re = new RegExp(hwCompat[1].slice(1, -1));

	ok(!re.test(entries[0]), 'the board compatible string alone is not hardware-capable');
	ok(entries.some(entry => re.test(entry)),
		'the AN7581 compatible string matches after splitting on NUL');
}
else {
	ok(false, 'core defines the HW_COMPAT regexp');
}

const mtkCompat = core.match(/^const MTK_COMPAT = (\/.*\/);$/m);

ok(mtkCompat != null, 'core defines the MediaTek compatible regexp');

if (mtkCompat) {
	const re = new RegExp(mtkCompat[1].slice(1, -1));

	ok(re.test('mediatek,mt7986a'), 'MediaTek SoC compatible strings are recognised');
	ok(!re.test('airoha,an7581'), 'Airoha SoC compatible strings are not treated as MediaTek');
	ok(!re.test('gemtek,w1700k-ubi'), 'board compatible strings are not treated as MediaTek');
}

ok(/wed: find_wed\(\) != null && mtk_platform\(\)/.test(core),
	'WED is advertised only on MediaTek platforms');
ok(/mtk_platform\(\) && engine == 'flow_offloading'/.test(core),
	'WED is written only on MediaTek platforms');

ok(/cca_value\(current_cca \?\? 'cubic', features\.cca\)/.test(core),
	'defaults preserve the current congestion control algorithm');
ok(!/cca_value\('cubic', features\.cca\)/.test(core),
	'defaults do not force cubic over the current sysctl');

ok(/cursor\.set\(CONFIG, SECTION, 'fastpath_fo_hw_applied', fo_hw\)/.test(core),
	'defaults record the initial hardware-offload write-back');
ok(/set_config\(cursor, 'fastpath_fo_hw_applied', desired\.flow_offloading_hw\)/.test(core),
	'apply records the hardware-offload value it manages');
ok(!/desired\.flow_offloading_hw = \(engine == 'flow_offloading' && settings\.fo_hw && features\.offloading_hw\) \? '1' : '0'/.test(core),
	'apply keeps a manually enabled firewall setting on an unknown platform');
ok(/result\.hw = boolval\(cursor\.get\(CONFIG, SECTION, 'fastpath_fo_hw'\)\)/.test(core),
	'status derives hardware offload from the TurboACC setting, not the firewall alone');

/* Every external command is a fixed string; no uci value reaches the shell. */
const systemCalls = core.match(/system\((.*)\)/g) || [];

ok(systemCalls.length > 0, 'core invokes external helpers through system()');

for (const call of systemCalls)
	ok(!/cursor\.get|settings\.|features\./.test(call),
		'system() never interpolates configuration values: ' + call);

/* --- entry point ---------------------------------------------------------- */

ok(/import \* as core from 'turboacc\.core'/.test(main), 'main.uc imports the core module');

for (const action of [ 'apply', 'stop', 'defaults', 'detect', 'status' ])
	ok(new RegExp("action == '" + action + "'").test(main), 'main.uc dispatches ' + action);

ok(main.includes("printf('%J\\n'"), 'main.uc prints JSON for query actions');
ok(/exit\(1\)/.test(main), 'main.uc fails on unknown actions');

/* --- rpcd plugin ---------------------------------------------------------- */

ok(/import \* as core from 'turboacc\.core'/.test(plugin), 'rpcd plugin reuses the core module');
ok(plugin.includes("'luci.turboacc':"), 'rpcd plugin registers the luci.turboacc object');
ok(/getSystemFeatures:\s*\{/.test(plugin), 'rpcd plugin exposes getSystemFeatures');
ok(/getStatus:\s*\{/.test(plugin), 'rpcd plugin exposes getStatus');

/* --- shell scripts -------------------------------------------------------- */

for (const [ name, body ] of [ [ 'init.d', init ], [ 'uci-defaults', defaults ] ]) {
	ok(/^#!\/bin\/sh/.test(body), name + ' uses /bin/sh');
	ok(!/\[\[/.test(body), name + ' has no bash [[ test');
	ok(!/^\s*function /m.test(body), name + ' defines no bash functions');
}

ok(/IPKG_INSTROOT/.test(defaults), 'uci-defaults is inert while building the image');
ok(defaults.includes('[ -x /usr/bin/ucode ]'), 'uci-defaults checks for ucode before running');
ok(/\/etc\/init\.d\/turboacc enable/.test(defaults), 'uci-defaults enables the service');
ok(/rm -f \/tmp\/luci-indexcache/.test(defaults) || /luci-indexcache/.test(defaults),
	'uci-defaults clears the LuCI index cache');

for (const file of [ 'root/etc/init.d/turboacc', 'root/etc/uci-defaults/90-turboacc' ]) {
	const result = spawnSync('sh', [ '-n', path.join(__dirname, '..', file) ], { encoding: 'utf8' });

	ok(result.status === 0, 'shell syntax: ' + file, result.stderr);
}

/* --- optional: compile the ucode sources ---------------------------------- */

const fs = require('fs');
const ucodeBin = [ process.env.UCODE, '/usr/bin/ucode', '/usr/local/bin/ucode' ]
	.filter(Boolean)
	.find(candidate => fs.existsSync(candidate));

if (!ucodeBin) {
	console.log('skip  ucode bytecode check (ucode interpreter not available)');
}
/*
 * core.uc is only valid as an imported module (`export` is rejected when the
 * file is compiled as a script), so it is checked through its two importers,
 * which is also how the router loads it.
 */
else {
	const files = [
		'root/usr/share/ucode/turboacc/main.uc',
		'root/usr/share/rpcd/ucode/luci.turboacc'
	];
	const out = path.join(os.tmpdir(), 'turboacc-test.uc');

	for (const file of files) {
		const result = spawnSync(ucodeBin, [
			'-L', path.join(__dirname, '..', 'root', 'usr', 'share', 'ucode'),
			'-c', '-o', out, path.join(__dirname, '..', file)
		], { encoding: 'utf8' });

		ok(result.status === 0, 'ucode compiles: ' + file,
			(result.stderr || '') + (result.stdout || ''));
	}
}

summary('ucode.test.js');
