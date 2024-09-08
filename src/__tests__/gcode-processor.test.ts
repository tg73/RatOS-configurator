/* eslint-disable no-console */
import path from 'node:path';
import { describe, expect, test, bench } from 'vitest';


describe('gcode-processor', (async) => {
	test('foo99', async () => {
		console.log('In foo99');
		const name = path.join(__dirname, 'fixtures', 'v-core-200.json');
		//const file = createReadStream(name);
		//const toLines = split();
		//let idx = 0;
		//toLines.on('data', function (line) {
		//	console.log('%d: %s', ++idx, line);
		//});

		//let ll = <string[]>[];
		//await pipeline(file, toLines);
	});
});
