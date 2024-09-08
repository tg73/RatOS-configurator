/* eslint-disable no-console */
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test, bench } from 'vitest';
import split from 'split2';
import { stdout } from 'process';
import { pipeline } from 'node:stream/promises';
import { BookmarkingWriter, SlidingWindowLineProcessor } from '@/server/gcode-processor/StreamingLineProcessor';

describe('gcode-processor', (async) => {
	test('foo99', async () => {
		console.log('In foo99');
		const name = path.join(__dirname, 'fixtures', 'v-core-200.json');
		let fh = await fs.open('/home/tom/temp/test.out', 'w');
		await pipeline(
			createReadStream(name),
			split(),
			new SlidingWindowLineProcessor((line, getNearbyLine) => {
				console.log(line);
				return line;
			}),
			new BookmarkingWriter(fh),
		);
	});
});
