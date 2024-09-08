/* eslint-disable no-console */
import { describe, expect, test, bench } from 'vitest';
import { createReadStream, fstat } from 'fs';
import { open, FileHandle } from 'fs/promises';
import split from 'split2';
import path from 'path';
import { stdout } from 'process';
import { pipeline } from 'node:stream/promises';
import { Transform, TransformCallback, TransformOptions, Writable } from 'node:stream';
import { never } from 'zod';

interface Window {
	// Gets a line before (-ve offset) or after (+ve offset) the current line being processed.
	getLine(offset: number): string;
}

interface LineRewriter {
	rewrite(fh: FileHandle, newLine: string): void;
}

type NonUndefined<T> = T extends undefined ? never : T;

class Deferred<T> {
	#_value?: T;

	get value(): T {
		if (this.#_value === undefined) {
			throw new Error('The value has not been set.');
		}
		return this.#_value;
	}

	set value(value: NonUndefined<T>) {
		if (this.#_value !== undefined) {
			throw new Error('The value has already been set and cannot be changed');
		}
		this.#_value = value;
	}

	getValueOrUndefined(): T | undefined {
		return this.#_value;
	}
}

// rewriter.value will be set when the line is first written to disk. The LineRewriter instance will know the
// file byte offset and byte count of the original line. The new line must not be longer than
// the original line (in terms of encoded bytes), and will be right-padded with spaces as needed (which is gcode compatible).
// Padding could be configurable or abstracted.
type RewriteableLine = { line: string; rewriter: Deferred<LineRewriter> };

/**
 * Performs analysis and optionally mutation of a line.
 * 
 * The callback must return one of:
 * * `string`: the original line, or a different `string` to replace the orinal line
 * * `RewritableLine`: ##TODO##
 * * `null`: indicates that the original line should be removed.
 */
type ProcessLineCallback = (
	line: string,
	getNearbyLine: (offset: number) => string | null,
) => string | RewriteableLine | null;

class WindowThing extends Transform {
	/*
	 * Holds circular buffer
	 */
	private buffer = new Array<string>(10);
	
	// 	
	constructor(
		private callback: ProcessLineCallback
	) {
		super({ objectMode: true });
	}

	_transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback): void	{
		// Populate buffer (or end):
		// this._buffer append, then callback(), until len(_buffer) = 10
				
		// process lines up to bias (centre) pos
		// for (i 0 to 5) this.callback( this._buffer[i], (offset: number) => xxx )

		// callback()

		
	}

	_flush(callback: TransformCallback): void {
		
	}
}

class WriterThing extends Writable {
	constructor(fh: FileHandle) {
		super();
	}


}

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

		//-----
		
	});
});
