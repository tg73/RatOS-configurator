/*
https://www.paigeniedringhaus.com/blog/streams-for-the-win-a-performance-comparison-of-node-js-methods-for-reading-large-datasets-pt-2

The above article compares fs.readFile(), fs.createReadStream() & rl.readLine(), and event-stream.
It concludes that only event-stream can handle multi-gb files. event-stream was also the winner for performance.

*/

import { createReadStream, fstat } from 'fs';
import { open, FileHandle } from 'fs/promises';
import split from 'split2';
import path from 'path';
import { stdout } from 'process';
import { pipeline } from 'node:stream/promises';
import { Transform, TransformCallback, TransformOptions, Writable } from 'node:stream';
import { never } from 'zod';
import { Deferred } from '@/server/gcode-processor/Deferred';
import { RingBuffer } from 'ring-buffer-ts';

interface Window {
	// Gets a line before (-ve offset) or after (+ve offset) the current line being processed.
	getLine(offset: number): string;
}

class Bookmark {
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
class BookmarkedLine {
	constructor(line: string) {
		this.line = line;
		this.writtenLine = new Deferred<Bookmark>();
	}

	readonly line: string;
	readonly writtenLine: Deferred<Bookmark>;

	toString() {
		return this.line;
	}
}

/**
 * Performs analysis and optionally mutation of a line.
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
type ProcessLineCallback = (
	line: string,
	getNearbyLine: (offset: number) => string | null,
) => string | BookmarkedLine | null;

class SlidingWindowLineProcessor extends Transform {
	constructor(
		private callback: ProcessLineCallback,
		public readonly maxLinesAhead = 10,
		public readonly maxLinesBehind = 10,
	) {
		super({ objectMode: true });
		this.#buf = new RingBuffer<string>(maxLinesAhead + maxLinesBehind + 1);
	}

	#position = 0;

	/*
	 * Holds circular buffer
	 */
	#buf: RingBuffer<string>;

	_transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback): void {
		// Populate buffer (or end):
		// this._buffer append, then callback(), until len(_buffer) = 10
		// process lines up to bias (centre) pos
		// for (i 0 to 5) this.callback( this._buffer[i], (offset: number) => xxx )
		// callback()
	}

	_flush(callback: TransformCallback): void {}
}

// TODO: OutputSink should have only the members of FileHandle that we need for
// writing ops, then a buffer-backed mock can be developed.
interface OutputSink {}

class BookmarkingWriter extends Writable {
	constructor(private fh: FileHandle) {
		super({ objectMode: true });
	}

	#bytesWritten: number = 0;

	_write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
		if (chunk === null) {
			return callback();
		} else if (chunk instanceof BookmarkedLine) {
			this.fh.write(chunk.line).then(
				(result) => {
					chunk.writtenLine.value = new Bookmark(this.#bytesWritten, result.bytesWritten);
					this.#bytesWritten += result.bytesWritten;
					return callback();
				},
				(reason) => callback(new Error(reason)),
			);
		} else if (typeof chunk === 'string') {
			this.fh.write(chunk).then(
				(result) => {
					this.#bytesWritten += result.bytesWritten;
					return callback();
				},
				(reason) => callback(new Error(reason)),
			);
		} else {
			callback(new Error('Unexpected type!'));
		}
	}
}
