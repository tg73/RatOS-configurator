/* eslint-disable prettier/prettier */
/**
 * @file StreamingLineProcessor.ts
 * @description
 * TODO
 *
 * @author Tom Glastonbury <t@tg73.net>
 * @license MIT
 * @copyright 2024
 *
 * THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
 * PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 * LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 * TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
 * USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

// TODO: Exception handling!

import { ThumbsDown } from 'lucide-react';
import { Transform, TransformCallback, TransformOptions, Writable } from 'node:stream';
import { RingBuffer } from 'ring-buffer-ts';

// Inspired by https://stackoverflow.com/a/43811543
export abstract class BackPressureTransform extends Transform {
	constructor(opts?: TransformOptions){
		super(opts);
	}
	
	protected abstract transformChunk(chunk: any, encoding: BufferEncoding): IterableIterator<any>;

	#continueTransform: (() => void) | null = null;
	#transforming = false;
	#dbgTransformCallCount = 0;

	_transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback): void {
		if ( this.#continueTransform !== null){
			//console.log(`${++this.#dbgTransformCallCount}: _transform !!! RE-ENTRANT !!!`);
			return callback(new Error('re-entrant call to _transform'));
		}

		// if ( ++this.#dbgTransformCallCount % 100 == 0 || this.#dbgTransformCallCount > 600 ) {
		// 	console.log(`${this.#dbgTransformCallCount}: _transform`);
		// }
		
		this.#transforming = true;

		let iter = this.transformChunk(chunk,encoding);
		let current = iter.next();

		if (current.done) {
			// Nothing to push
			callback();
		} else{
			this.#continueTransform = () => {
				// if ( this.#dbgTransformCallCount > 600 )
				// 	console.log(`${this.#dbgTransformCallCount}: running`);
				try {				
					while ( !current.done ) {
						let next = iter.next();
						// if ( this.#dbgTransformCallCount > 600 )
						// 	console.log(`${this.#dbgTransformCallCount}: ${next.done?'push last':'push'}`);
						if ( !this.push(current.value) && !next.done) {
							// TODO: Why does the original check for two false returns?
							// Also, the original while loop looks like it could overflow lines[] due to doing nextLine++ in one iteration...

							current = next;
							// if ( this.#dbgTransformCallCount > 600 )
							// 	console.log(`${this.#dbgTransformCallCount}: suspending`);
							return;
						}
						current = next;
					}

					// if ( this.#dbgTransformCallCount > 600 )
					// 	console.log(`${this.#dbgTransformCallCount}: finished`);
					this.#continueTransform = null;		
					return callback();
				} catch ( err ) {
					if ( err instanceof Error ){
						return callback(err);
					} else {
						return callback(new Error('Unknown error (see data)'), err);
					}				
				}
			}

			this.#continueTransform();
		}
		this.#transforming = false;

		// if ( this.#dbgTransformCallCount == 638 && false ){
		// 	this.on('data', () => console.log('               sif.pause'));
		// 	this.on('pause', () => console.log('               sif.pause'));
		// 	this.on('drain', () => console.log('               sif.drain'));
		// 	this.on('readable', () => console.log('               sif.readable'));
		// 	this.on('resume', () => console.log('               sif.resume'));
		// 	this.on('drain', () => console.log('               sif.drain'));
		// }
	}

	_read(size: number): void {
		if ( this.#transforming) {
			// if ( this.#dbgTransformCallCount > 0 )
			// 	console.log(`${this.#dbgTransformCallCount} read, transforming=true`);
		}
		if (!this.#transforming && this.#continueTransform !== null) {
			// if ( this.#dbgTransformCallCount > 600 )
			// 	console.log(`${this.#dbgTransformCallCount} read, resuming`);
			this.#continueTransform();
		} else {
			// if ( this.#dbgTransformCallCount > 600 )
			// 	console.log(`${this.#dbgTransformCallCount} read, super`);
			// if ( this.#dbgTransformCallCount == 657)
			// {
			// 	console.log("xx");
			// }
			super._read(size);
		}
	}
}

export class Bookmark {
	constructor(
		public readonly originalLine: string,
		public readonly byteOffset: number,
		public readonly byteLength: number,
	) {}
}

export type BookmarkKey = string | symbol;

export class ProcessLineContext {
	constructor(item: BufferItem, getLineContextOrUndefined: (offset: number) => ProcessLineContext | undefined) {
		this.#item = item;
		this.#getLineOrUndefined = getLineContextOrUndefined;
	}

	#getLineOrUndefined: (offset: number) => ProcessLineContext | undefined;
	#item: BufferItem;

	public get line(): string | null {
		return this.#item.line;
	}

	public set line(value: string | null) {
		this.#item.line = value;
	}

	public get bookmarkKey(): BookmarkKey | undefined {
		return this.#item.bookmarkKey;
	}

	public set bookmarkKey(key: BookmarkKey) {
		if (this.#item.bookmarkKey === undefined) {
			this.#item.bookmarkKey = key;
		} else {
			throw new Error('The bookmark key has already been set and cannot be changed.');
		}
	}

	public getLine(offset: number): ProcessLineContext {
		if (offset == 0) {
			return this;
		}
		let ctx = this.#getLineOrUndefined(offset);
		if (ctx) {
			return ctx;
		}
		throw new RangeError('The specified offset is outside the available window.');
	}

	public getLineOrUndefined(offset: number): ProcessLineContext | undefined {
		if (offset == 0) {
			return this;
		}
		return this.#getLineOrUndefined(offset);
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
export type ProcessLineCallback = (context: ProcessLineContext) => void;

class BufferItem {
	constructor(public line: string | null) {}

	public bookmarkKey: BookmarkKey | undefined;
}

/**
 * Principle of Operation
 * ----------------------
 * Analysis and possible update of line content is performed by the `ProcessLineCallback` callback passed to
 * the ctor. `SlidingWindowLineProcessor` is only responsible for presenting data for analysis.
 *
 * `SlidingWindowLineProcessor` maintains a ring buffer of lines. Other than at the start and end sections of the stream,
 * processing is invoked on the nominal midpoint of the ring buffer, lying between `maxLinesBehind` and `maxLinesAhead`.
 * `ProcessLineCallback` can access by offset any other line in the current window and modify it. Lines are only
 * pushed to the output of the transform just prior to being removed from the ring buffer when a new item is added.
 */
export class SlidingWindowLineProcessor extends BackPressureTransform {
	constructor(
		private callback: ProcessLineCallback,
		public readonly maxLinesAhead = 10,
		public readonly maxLinesBehind = 10,
	) {
		super({ objectMode: true });

		this.#buf = new RingBuffer<BufferItem>(maxLinesBehind + maxLinesAhead + 1);
		/*
		this.on('ready', () => console.log('window.ready'));
		this.on('error', () => console.log('window.error'));
		this.on('finish', () => console.log('window.finish'));
		this.on('open', () => console.log('window.open'));
		this.on('pipe', () => console.log('window.pipe'));
		this.on('unpipe', () => console.log('window.unpipe'));
		this.on('drain', () => console.log('window.drain'));
		this.on('error', () => console.log('window.error'));
		this.on('readable', () => console.log('window.readable'));
		this.on('resume', () => console.log('window.resume'));
	*/
	}

	/**
	 * The current position within `#buf`. When the window is primed and streaming
	 * is well underway, `#position` will always be `maxLinesBehind`. During initial priming,
	 * `#position` can be less than `maxLinesBehind`, and while processing the end of
	 * the stream in `_flush`, `#position` can be greater than `maxLinesBehind`.
	 */
	#position = -1;

	#buf: RingBuffer<BufferItem>;

	#getLineContext(offset: number): ProcessLineContext | undefined {
		let p = this.#position + offset;
		if (p < 0 || p >= this.#buf.getBufferLength()) {
			return undefined;
		}
		return new ProcessLineContext(this.#buf.get(p)!, this.#getLineContextClosure);
	}

	#getLineContextClosure = (offset: number) => this.#getLineContext(offset);

	protected *transformChunk(chunk: any, encoding: BufferEncoding): IterableIterator<any> {
		if (typeof chunk !== 'string') {
			throw new Error('chunk must be a string');
		}

		if (!this.#buf.isFull()) {
			// Not fully primed yet.
			this.#buf.add(new BufferItem(chunk));

			if (!this.#buf.isFull()) {
				return;
			}
		}

		if (this.#position == -1) {
			// Priming of the ring buffer has just completed. Process all lines up to position `maxLinesBehind`.
			while (this.#position < this.maxLinesBehind) {
				++this.#position;
				this.callback(this.#getLineContext(0)!);
			}
			return;
		}

		if (this.#position != this.maxLinesBehind) {
			throw new Error('Unexpected state!');
		}

		// TODO: push the item that will get displaced from the ring buffer, then displace it. This
		// allows lines to be changed and bookmark keys set via offset up until the BufferItem must
		// leave the window.

		const itemToPush = this.#buf.get(0)!;
		let pushResult = true;

		if (itemToPush.line) {
			//pushResult = this.push(itemToPush);
			yield itemToPush;
		}

		this.#buf.add(new BufferItem(chunk));
		this.callback(this.#getLineContext(0)!);

		// if (pushResult) {
		// 	return callback();
		// } else {
		// 	this.once('resume', () => callback());
		// 	return;
		// }		
	}

	xxx_transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback): void {
		if (typeof chunk !== 'string') {
			callback(new Error('chunk must be a string'));
		}

		if (!this.#buf.isFull()) {
			// Not fully primed yet.
			this.#buf.add(new BufferItem(chunk));

			if (!this.#buf.isFull()) {
				return callback();
			}
		}

		if (this.#position == -1) {
			// Priming of the ring buffer has just completed. Process all lines up to position `maxLinesBehind`.
			while (this.#position < this.maxLinesBehind) {
				++this.#position;
				this.callback(this.#getLineContext(0)!);
			}
			return callback();
		}

		if (this.#position != this.maxLinesBehind) {
			throw new Error('Unexpected state!');
		}

		// TODO: push the item that will get displaced from the ring buffer, then displace it. This
		// allows lines to be changed and bookmark keys set via offset up until the BufferItem must
		// leave the window.

		const itemToPush = this.#buf.get(0)!;
		let pushResult = true;

		if (itemToPush.line) {
			pushResult = this.push(itemToPush);
		}

		this.#buf.add(new BufferItem(chunk));
		this.callback(this.#getLineContext(0)!);

		if (pushResult) {
			return callback();
		} else {
			this.once('resume', () => callback());
			return;
		}
	}

	_flush(callback: TransformCallback): void {
		// eslint-disable-next-line no-console
		//console.log(`FLUSH: pos=${this.#position} glb=${this.#buf.getBufferLength()} size=${this.#buf.getSize()}`);

		// At this point:
		// 1. Any items in #buf at index > #position in #buf have not yet been processed.
		// 2. No items in #buf have been pushed.

		// Process all unprocessed items:
		while (this.#position < this.#buf.getBufferLength() - 1) {
			++this.#position;
			this.callback(this.#getLineContext(0)!);
		}

		// Push all items:
		return this.#pushAll(callback);
	}

	#pushAll(callback: TransformCallback, startIndex: number = 0): void {
		let index = startIndex;
		while (index < this.#buf.getBufferLength()) {
			if (!this.push(this.#buf.get(index))) {
				this.once('resume', () => {
					this.#pushAll(callback, index + 1);
				});
				return;
			}
			++index;
		}
		callback();
	}
}

export class BufferItemStringifier extends BackPressureTransform {
	constructor() {
		super({ objectMode: true });
	}

    protected *transformChunk(chunk: any, encoding: BufferEncoding): IterableIterator<any> {
		if (chunk instanceof BufferItem && chunk.line) {
			yield chunk.line + '\n';
		} else if (typeof chunk === 'string') {
			yield chunk +'\n';
		}
	}
	/*
	pc: number = 0;
	_transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback): void {
		
		if (chunk instanceof BufferItem && chunk.line) {
			if (!this.push(chunk.line + '\n')) {
				//console.log('window: push false after %d good', this.pc);
				this.pc = 0;
				/*
				this.once('readable', () => {
					console.log('window: readable callback');
					callback();
				} );
				return;
				* /
			} else {
				++this.pc;
			}
			if (!(this.pc % 10)) {
				//console.log('window: %d good pushes...', this.pc);
			}
		}

		return callback();
	}
	*/
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

	close(): Promise<void>;
}

export interface BookmarkCollection {
	getBookmark(key: BookmarkKey): Bookmark | undefined;
	getBookmarks(): IterableIterator<[BookmarkKey, Bookmark]>;
}

export class BookmarkingWriter extends Writable implements BookmarkCollection {
	constructor(
		private readonly fh: BookmarkingWriterFileHandle,
		private readonly beforeClose?: (fh: BookmarkingWriterFileHandle, bookmarks: BookmarkCollection) => void,
		public readonly newline: string = '\n',
		public readonly encoding: BufferEncoding = 'utf8',
	) {
		super({ objectMode: true });
		this.on('close', async () => {
			beforeClose?.(fh, this);
			await fh.close();
		});
	}

	#bookmarks: Map<BookmarkKey, Bookmark> = new Map<BookmarkKey, Bookmark>();
	#bytesWritten: number = 0;

	// async pattern in _write: https://github.com/nodejs/node/issues/31387

	async _write(chunk: any, notused_encoding: BufferEncoding, callback: (error?: Error | null) => void) {
		try {
			if (chunk instanceof BufferItem && chunk.line) {
				if (chunk.bookmarkKey) {
					let { bytesWritten } = await this.fh.write(chunk.line + this.newline, null, this.encoding);
					this.#bookmarks.set(chunk.bookmarkKey, new Bookmark(chunk.line, this.#bytesWritten, bytesWritten));
					this.#bytesWritten += bytesWritten;
				} else {
					let { bytesWritten } = await this.fh.write(chunk.line + this.newline, null, this.encoding);
					this.#bytesWritten += bytesWritten;
				}
				if (this.#bytesWritten % 100000 < 50) {
					// eslint-disable-next-line no-console
					console.log(`${this.#bytesWritten}`);
				}
			} else if (chunk) {
				return callback(new Error('Unexpected type!'));
			}
			return callback();
		} catch (err) {
			return callback(err instanceof Error ? err : new Error('Unknown error.'));
		}
	}

	public getBookmark(key: BookmarkKey): Bookmark | undefined {
		return this.#bookmarks.get(key);
	}

	public getBookmarks(): IterableIterator<[BookmarkKey, Bookmark]> {
		return this.#bookmarks.entries();
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
	fh: BookmarkingWriterFileHandle,
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
	buf = Buffer.from(line.padEnd(line.length + bookmark.byteLength - buf.length - 1) + '\n');
	if (buf.length != bookmark.byteLength) {
		throw new Error('Unexpected length mismatch!');
	}
	await fh.write(buf, undefined, undefined, bookmark.byteOffset);
}
