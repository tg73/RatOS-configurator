/**
 * @file SlidingWindowLineProcessor.ts
 * @description
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

import { Transform, TransformCallback, Writable } from 'node:stream';
import { RingBuffer } from 'ring-buffer-ts';
import { Bookmark, BookmarkableLine, BookmarkKey } from '@/server/gcode-processor/Bookmark';

export class ProcessLineContext {
	constructor(item: BookmarkableLine, getLineContextOrUndefined: (offset: number) => ProcessLineContext | undefined) {
		this.#item = item;
		this.#getLineOrUndefined = getLineContextOrUndefined;
	}

	#getLineOrUndefined: (offset: number) => ProcessLineContext | undefined;
	#item: BookmarkableLine;

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

export type ProcessLineCallback = (context: ProcessLineContext) => void;

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
export class SlidingWindowLineProcessor extends Transform {
	constructor(
		private callback: ProcessLineCallback,
		public readonly maxLinesAhead = 10,
		public readonly maxLinesBehind = 10,
	) {
		super({ objectMode: true });

		this.#buf = new RingBuffer<BookmarkableLine>(maxLinesBehind + maxLinesAhead + 1);
	}

	/**
	 * The current position within `#buf`. When the window is primed and streaming
	 * is well underway, `#position` will always be `maxLinesBehind`. During initial priming,
	 * `#position` can be less than `maxLinesBehind`, and while processing the end of
	 * the stream in `_flush`, `#position` can be greater than `maxLinesBehind`.
	 */
	#position = -1;

	#buf: RingBuffer<BookmarkableLine>;

	#getLineContext(offset: number): ProcessLineContext | undefined {
		let p = this.#position + offset;
		if (p < 0 || p >= this.#buf.getBufferLength()) {
			return undefined;
		}
		return new ProcessLineContext(this.#buf.get(p)!, this.#getLineContextClosure);
	}

	#getLineContextClosure = (offset: number) => this.#getLineContext(offset);

	_transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback): void {
		if (typeof chunk !== 'string') {
			throw new Error('chunk must be a string');
		}

		if (!this.#buf.isFull()) {
			// Not fully primed yet.
			this.#buf.add(new BookmarkableLine(chunk));

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
			return callback(new Error('Unexpected state!'));
		}

		const itemToPush = this.#buf.get(0)!;

		this.#buf.add(new BookmarkableLine(chunk));
		this.callback(this.#getLineContext(0)!);

		if (itemToPush.line) {
			this.push(itemToPush);
		}

		callback();
	}

	_flush(callback: TransformCallback): void {
		// At this point:
		// 1. Any items in #buf at index > #position in #buf have not yet been processed.
		// 2. No items in #buf have been pushed.

		// Process all unprocessed items:
		while (this.#position < this.#buf.getBufferLength() - 1) {
			++this.#position;
			this.callback(this.#getLineContext(0)!);
		}

		// Push all items:
		for (let index = 0; index < this.#buf.getBufferLength(); ++index) {
			this.push(this.#buf.get(index));
		}
		callback();
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

	close(): Promise<void>;
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
