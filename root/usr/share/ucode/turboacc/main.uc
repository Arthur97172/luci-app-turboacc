// SPDX-License-Identifier: GPL-3.0-only
//
// Copyright (C) 2026 Arthur97172
//
// CLI entry point: ucode /usr/share/ucode/turboacc/main.uc [apply|stop|defaults|detect|status]

'use strict';

import * as core from 'turboacc.core';

let action = length(ARGV) ? ARGV[0] : 'apply';

if (action == 'apply') {
	core.apply();
}
else if (action == 'stop') {
	core.stop();
}
else if (action == 'defaults') {
	core.defaults();
}
else if (action == 'detect') {
	printf('%J\n', core.detect());
}
else if (action == 'status') {
	printf('%J\n', core.status());
}
else {
	warn('Usage: main.uc [apply|stop|defaults|detect|status]\n');
	exit(1);
}
