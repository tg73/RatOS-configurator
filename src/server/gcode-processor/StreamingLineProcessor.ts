/* eslint-disable no-console */
/**
 * @file StreamingLineProcessor.ts
 * @description
 * TODO
 *
 * @author Tom Glastonbury <t@tg73.net>
 * @license MIT
 * @copyright 2024
 */

// TODO: Exception handling!

/*
https://www.paigeniedringhaus.com/blog/streams-for-the-win-a-performance-comparison-of-node-js-methods-for-reading-large-datasets-pt-2

The above article compares fs.readFile(), fs.createReadStream() & rl.readLine(), and event-stream.
It concludes that only event-stream can handle multi-gb files. event-stream was also the winner for performance.

*/

import { createReadStream, fstat } from 'fs';
import * as fssync from 'node:fs';
import { open, FileHandle } from 'fs/promises';
import split from 'split2';
import path from 'path';
import { stdout } from 'process';
import { pipeline } from 'node:stream/promises';
import { Transform, TransformCallback, TransformOptions, Writable } from 'node:stream';
import { never } from 'zod';
import { Deferred } from '@/server/gcode-processor/Deferred';
import { RingBuffer } from 'ring-buffer-ts';
import { of } from 'rxjs';

export class Bookmark {
	constructor(
		public readonly byteOffset: number,
		public readonly byteLength: number,
	) {}
}

/**
 * * `RewritableLine.line` is the original line, or a different `string` to replace the original line.
 * * `RewritableLine.rewriter.value` will be set when the line is written to a file, and allows the line to be
 *    replaced once stream processing is complete. The replacement line cannot occupy more bytes than
 *    the original line, so `RewritableLine.line` should be padded to allow for any extra space that may
 *    be required.
 */
export class BookmarkedLine {
	constructor(line: string) {
		this.line = line;
		this.bookmark = new Deferred<Bookmark>();
	}

	readonly line: string;
	readonly bookmark: Deferred<Bookmark>;

	toString() {
		return this.line;
	}
}

/**
 * Performs analysis and optionally mutation of a line.
 * @param line The line to process.
 * @param getNearbyLine A callback that obtains a nearby line. `null` indicates that a preceeding line has
 *   been removed. `undefined` indicates that the given `offset` is outside the available window.
 *
 * The callback must return one of:
 * * `string`: the original line, or a different `string` to replace the original line
 * * `null`: indicates that the original line should be removed.
 * * `RewritableLine`:
 *   * `RewritableLine.line` is the original line, or a different `string` to replace the original line.
 *   * `RewritableLine.rewriter.value` will be set when the line is written to a file, and allows the line to be
 *     replaced once stream processing is complete. The replacement line cannot occupy more bytes than
 *     the original line, so `RewritableLine.line` should be padded to allow for any extra space that may
 *     be required.
 */
export type ProcessLineCallback = (
	line: string,
	getNearbyLine: (offset: number) => string | null | undefined,
) => string | BookmarkedLine | null;

export class SlidingWindowLineProcessor extends Transform {
	constructor(
		private callback: ProcessLineCallback,
		public readonly maxLinesAhead = 10,
		public readonly maxLinesBehind = 10,
	) {
		super({ objectMode: true });
		this.#buf = new RingBuffer<string>(maxLinesBehind + maxLinesAhead + 1);
		//this.on('drain', () => console.log(">> DRAIN"));
		//this.on('pause', () => console.log(">> PAUSE"));
		//this.on('resume', () => console.log(">> RESUME"));
	}

	/**
	 * The current position within `#buf`. When the window is primed and streaming
	 * is well underway, `#position` will be `maxLinesBehind`. During initial priming,
	 * `#position` can be less than `maxLinesBehind`, and while processing the end of
	 * the stream in `_flush`, `#position` can be greater than `maxLinesBehind`.
	 * Other than during callback exectuion, the line at `#position` has already been
	 * processed.
	 */
	#position = -1;

	#buf: RingBuffer<string>;

	#getNearbyLine(offset: number): string | null | undefined {
		let p = this.#position + offset;
		if (p < 0 || p >= this.#buf.getBufferLength()) {
			return undefined;
		}
		return this.#buf.get(p);
	}

	#processExtraLines(action: 'prime' | 'flush', tfCallback: TransformCallback): void {
		let limit = action === 'prime' ? this.maxLinesBehind : this.#buf.getBufferLength() - 1;

		while (this.#position < limit) {
			++this.#position;
			let result = this.callback(this.#buf.get(this.#position)!, this.#getNearbyLine);
			if (result !== null) {
				if (!this.push(result)) {
					this.once('resume', () => {
						this.#processExtraLines(action, tfCallback);
					});
					return;
				}
			}
		}
		tfCallback();
	}

	_transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback): void {
		// Populate buffer (or end):
		// this._buffer append, then callback(), until len(_buffer) = 10
		// process lines up to bias (centre) pos
		// for (i 0 to 5) this.callback( this._buffer[i], (offset: number) => xxx )
		// callback()

		if (typeof chunk !== 'string') {
			callback(new Error('chunk must be a string'));
		}

		if (!this.#buf.isFull()) {
			// Not fully primed yet.
			this.#buf.add(chunk);

			if (!this.#buf.isFull()) {
				return callback();
			}
		}

		if (this.#position == -1) {
			// Priming of the ring buffer has just completed. Process all lines up to position `maxLinesBehind`.
			return this.#processExtraLines('prime', callback);
		}

		if (this.#position != this.maxLinesBehind) {
			throw new Error('Unexpected state!');
		}

		this.#buf.add(chunk);
		let result = this.callback(this.#buf.get(this.#position)!, this.#getNearbyLine);

		if (result !== null) {
			if (!this.push(result)) {
				this.once('resume', () => callback());
				return;
			}
		}

		return callback();
	}

	_flush(callback: TransformCallback): void {
		// eslint-disable-next-line no-console
		//console.log(`FLUSH: pos=${this.#position} glb=${this.#buf.getBufferLength()} size=${this.#buf.getSize()}`);
		return this.#processExtraLines('flush', callback);
	}
}

/**
 * `BookmarkingWriterDestination` contains the methods of `FileHandle` required by `BookmarkingWriter` and
 * `replaceBookmarkedGcodeLine`. This allows other implementations to be used, for example for testing without
 * using disk writes.
 */
export interface BookmarkingWriterFileHandle {
	write(
		data: string,
		position?: number | null,
		encoding?: BufferEncoding | null,
	): Promise<{
		bytesWritten: number;
		buffer: string;
	}>;

	write<TBuffer extends Uint8Array>(
		buffer: TBuffer,
		offset?: number | null,
		length?: number | null,
		position?: number | null,
	): Promise<{
		bytesWritten: number;
		buffer: TBuffer;
	}>;
}

export class BookmarkingWriter extends Writable {
	constructor(
		private readonly fd: number, //BookmarkingWriterFileHandle,
		public readonly encoding: BufferEncoding = 'utf8',
	) {
		super({ objectMode: true });
	}

	#bytesWritten: number = 0;

	// https://github.com/nodejs/node/issues/31387

	_write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
		try {
			if (chunk === null) {
				return callback();
			} else if (chunk instanceof BookmarkedLine) {
				/*
				this.fh.write(chunk.line, null, this.encoding).then(
					(result) => {
						chunk.bookmark.value = new Bookmark(this.#bytesWritten, result.bytesWritten);
						this.#bytesWritten += result.bytesWritten;
						return callback();
					},
					(reason) => callback(new Error(reason)),
				);
				*/
			} else if (typeof chunk === 'string') {
				//console.log('.');
				//return callback();
				fssync.write(this.fd, chunk, (err, bytesWritten) => {
					if (err) {
						return callback(err);
					}
					this.#bytesWritten += bytesWritten;
					return callback();
				});
				return;
			} else {
				return callback(new Error('Unexpected type!'));
			}
		} catch (err) {
			return callback(err instanceof Error ? err : new Error('Unknown error.'));
		}
	}
}

/**
 * Replaces a bookmarked line in a file. GCode-compatible padding is added as required to match the size of the line being
 * replaced. The file must be UTF8 encoded.
 * @param fh
 * @param bookmark
 * @param replacementLine
 * @param encoding
 */
export async function replaceBookmarkedGcodeLine(
	fh: FileHandle,
	bookmark: Bookmark,
	replacementLine: string,
): Promise<void> {
	let line = replacementLine.trimEnd();
	let buf = Buffer.from(line);
	if (buf.length + 1 > bookmark.byteLength) {
		// Too long, allowing for terminating \n.
		throw new RangeError(
			`The line cannot be replaced in-place. The replacement requires ${buf.length + 1} bytes, but only ${bookmark.byteLength} bytes are available.`,
		);
	}
	buf = Buffer.from(line.padEnd(buf.length - bookmark.byteLength - 1) + '\n');
	if (buf.length != bookmark.byteLength) {
		throw new Error('Unexpected length mismatch!');
	}
	await fh.write(buf, bookmark.byteOffset);
}
