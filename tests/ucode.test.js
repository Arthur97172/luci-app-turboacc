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
