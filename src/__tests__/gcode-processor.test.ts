import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { describe, test } from 'vitest';
import split from 'split2';
import { pipeline } from 'node:stream/promises';
import { SlidingWindowLineProcessor } from '@/server/gcode-processor/SlidingWindowLineProcessor';
import {
	BookmarkingBufferEncoder,
	replaceBookmarkedGcodeLine,
} from '@/server/gcode-processor/BookmarkingBufferEncoder';
import { Writable } from 'node:stream';

class MyDevNull extends Writable {
	//constructor(opts?: WritableOptions);
	public callcount: number = 0;

	_write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
		++this.callcount;
		callback();
	}
}

describe('gcode-processor', (async) => {
	test('test-pipeline-split-window-stringifier-writestream', { timeout: 60000 }, async () => {
		// About 29mb file.
		const name = '/home/tom/temp/big_private_test.gcode';
		// 767mb file:
		//const name = '/home/tom/temp/massive.gcode';
		let inThumbnail = false;
		let fh = await fs.open(name + '.out', 'w');

		await pipeline(
			createReadStream(name),
			split(),

			new SlidingWindowLineProcessor((ctx) => {
				// Demo: strip thumbnails
				if (inThumbnail) {
					if (ctx.line.startsWith('; thumbnail end')) {
						inThumbnail = false;
					}
				} else if (ctx.line.startsWith('; thumbnail begin')) {
					inThumbnail = true;
				}

				if (inThumbnail) {
					ctx.emit = false;
				} else {
					// Demo: Locate the START_PRINT line
					if (ctx.line.startsWith('START_PRINT ')) {
						// Bookmark it, and pad with extra space for retrospective modification.
						ctx.bookmarkKey = 'sp';
						ctx.line = ctx.line.padEnd(256);

						// And while we're here, modify the preceding line.
						let lineBefore = ctx.getLine(-1);
						lineBefore.line += ' <<< Modified while processing the START_PRINT line';
					}
				}
			}),

			new BookmarkingBufferEncoder(async (bookmarks) => {
				// This function is executed just before the transform is closed when the pipline is finishing.
				// Demo: retrospectively modify the START_PRINT line.
				let bm = bookmarks.getBookmark('sp');
				await replaceBookmarkedGcodeLine(fh, bm, 'BlahBlahBlah! ' + bm?.originalLine.trim());
			}),

			createWriteStream('|notused|', { fd: fh.fd, highWaterMark: 256 * 1024 }),
		);
	});
});
