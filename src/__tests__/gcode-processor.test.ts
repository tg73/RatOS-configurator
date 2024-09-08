/* eslint-disable no-console */
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test, bench } from 'vitest';
import split from 'split2';
import { stdout } from 'process';
import { pipeline } from 'node:stream/promises';
import {
	BookmarkedLine,
	BookmarkingWriter,
	SlidingWindowLineProcessor,
	replaceBookmarkedGcodeLine,
} from '@/server/gcode-processor/StreamingLineProcessor';

describe('gcode-processor', (async) => {
	test('foo99', async () => {
		console.log('In foo99');
		const name = path.join(__dirname, 'fixtures', 'v-core-200.json');
		let fh = await fs.open('/home/tom/temp/test.out', 'w');
		try {
			let counter = 0;
			let bm: BookmarkedLine | undefined;
			await pipeline(
				createReadStream(name),
				split({ maxLength: 4096 }),
				new SlidingWindowLineProcessor((line, getNearbyLine) => {
					++counter;
					if (counter == 2) {
						console.log(line + ' <<< BOOKMARKING!');
						bm = new BookmarkedLine(line);
						return bm;
					} else {
						console.log(line);
						return line;
					}
				}),
				new BookmarkingWriter(fh),
			);
			if (bm) {
				try {
					console.log(`${bm.bookmark.value.byteLength} bytes at offset ${bm.bookmark.value.byteOffset}`);
					await replaceBookmarkedGcodeLine(fh, bm.bookmark.value, 'hello!');
				} catch (err) {
					if (err instanceof Error) {
						console.log(err.message);
					}
				}
			}
		} finally {
			await fh.close();
		}
	});
});
