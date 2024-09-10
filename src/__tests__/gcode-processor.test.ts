/* eslint-disable no-console */
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'vitest';
import split from 'split2';
import { pipeline } from 'node:stream/promises';
var devnull = require('dev-null');

import {
	BookmarkingWriter,
	SlidingWindowLineProcessor,
	replaceBookmarkedGcodeLine,
	BufferItemStringifier,
} from '@/server/gcode-processor/StreamingLineProcessor';
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
	test('test-pipeline-split-window-stringifier-writestream', { timeout: 5000 }, async () => {
		// About 29mb large file.
		const name = '/home/tom/temp/big_private_test.gcode';
		let inThumbnail = false;
		let dn = new MyDevNull({ objectMode: true });
		let ws = createWriteStream(name + '.out');
		let sif = new BufferItemStringifier();
		// sif.on('pause', () => {
		// 	//console.log('sif.pause, uncorking ws');
		// 	ws.uncork();
		// });
		
		// ws.on('drain', () => {			
		// 	//console.log('ws.drain, NOT corking ws');
		// 	ws.cork();
		// });
		
		
		//ws.on('drain', () => console.log('ws.drain'));
		//ws.on('ready', () => console.log('ws.drain'));

		
		//sif.on('ready', () => console.log('sif.ready'));
		//sif.on('error', () => console.log('sif.error'));
		//sif.on('finish', () => console.log('sif.finish'));
		//sif.on('open', () => console.log('sif.open'));
		//sif.on('pipe', () => console.log('sif.pipe'));
		//sif.on('unpipe', () => console.log('sif.unpipe'));
		//sif.on('drain', () => console.log('sif.drain'));
		//sif.on('error', () => console.log('sif.error'));
		//sif.on('readable', () => console.log('sif.readable'));
		//sif.on('resume', () => console.log('sif.resume'));

		// ws.cork();
		await pipeline(
			createReadStream(name),
			split(),
			
			new SlidingWindowLineProcessor((ctx) => {
				if (inThumbnail) {
					if (ctx.line?.startsWith('; thumbnail end')) {
						inThumbnail = false;
					}
				} else if (ctx.line?.startsWith('; thumbnail begin')) {
					inThumbnail = true;
				}

				if (inThumbnail) {
					ctx.line = null;
				}
			}),
			
			sif,
			
			ws, //new MyDevNull({objectMode:true}), //ws,
		);
		console.log(dn.callcount);
	});
});

