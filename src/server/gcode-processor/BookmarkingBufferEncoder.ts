/**
 * @file BookmarkingBufferEncoder.ts
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

import { Transform, TransformCallback } from 'node:stream';
import { Bookmark, BookmarkKey, BookmarkableLine } from '@/server/gcode-processor/Bookmark';

export interface BookmarkCollection {
	getBookmark(key: BookmarkKey): Bookmark;
	getBookmarkOrUndefined(key: BookmarkKey): Bookmark | undefined;
	getBookmarks(): IterableIterator<[BookmarkKey, Bookmark]>;
}

/**
 * Consumes {@link BookmarkableLine} objects, encoding lines to {@link Buffer} to track actual
 * encoded byte length, tracks any requested bookmarks, and passes on the encoded
 * buffers. Intended to be piplined immediately after {@link SlidingWindowLineProcessor}.
 */
export class BookmarkingBufferEncoder extends Transform implements BookmarkCollection {
	constructor(
		private readonly beforeClose?: (bookmarks: BookmarkCollection) => void,
		public readonly newline: string = '\n',
		public readonly encoding: BufferEncoding = 'utf8',
	) {
		super({ objectMode: true });
		this.on('close', async () => {
			beforeClose?.(this);
		});
	}

	#bookmarks: Map<BookmarkKey, Bookmark> = new Map<BookmarkKey, Bookmark>();
	#bytesWritten: number = 0;

	_transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback): void {
		if (chunk instanceof BookmarkableLine && chunk.line) {
			let buffer = Buffer.from(chunk.line + this.newline, this.encoding);
			if (chunk.bookmarkKey) {
				this.#bookmarks.set(chunk.bookmarkKey, new Bookmark(chunk.line, this.#bytesWritten, buffer.byteLength));
			}
			this.#bytesWritten += buffer.byteLength;
			this.push(buffer);
			callback();
		} else if (chunk) {
			callback(new Error('Unexpected type!'));
		}
	}

	public getBookmark(key: BookmarkKey): Bookmark {
		let b = this.#bookmarks.get(key);
		if (b) {
			return b;
		}

		throw new RangeError('The specified bookmark key was not found.');
	}

	getBookmarkOrUndefined(key: BookmarkKey): Bookmark | undefined {
		return this.#bookmarks.get(key);
	}
	public getBookmarks(): IterableIterator<[BookmarkKey, Bookmark]> {
		return this.#bookmarks.entries();
	}
}
