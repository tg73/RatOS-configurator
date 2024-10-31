/**
 * @file integration.test.ts
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

/* eslint-disable no-console */

import {
	BookmarkingBufferEncoder,
	replaceBookmarkedGcodeLine,
} from '@/server/gcode-processor/BookmarkingBufferEncoder';
import { GCodeProcessor } from '@/server/gcode-processor/GCodeProcessor';
import { glob } from 'glob';
import { createReadStream, createWriteStream } from 'node:fs';
import fs, { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import split from 'split2';
import { describe, test, expect, chai } from 'vitest';

chai.use(require('chai-string'));

class NullSink extends Writable {
	_write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
		callback();
	}
}

async function processToNullWithoutBookmarkProcessing(gcodePath: string, abortSignal?: AbortSignal) {
	const gcodeProcessor = new GCodeProcessor(true, false, false, abortSignal);
	const encoder = new BookmarkingBufferEncoder(undefined, undefined, abortSignal);
	await pipeline(createReadStream(gcodePath), split(), gcodeProcessor, encoder, new NullSink());
}

// https://stackoverflow.com/a/43053803
function cartesian(...a: any) {
	return a.reduce((a: any, b: any) => a.flatMap((d: any) => b.map((e: any) => [d, e].flat())));
}

function replaceExtension(pathStr: string, extensionWithDot: string) {
	return path.format({ ...path.parse(pathStr), base: '', ext: extensionWithDot });
}

async function legacyAndModernGcodeFilesAreEquivalent(legacyPath: string, modernPath: string) {
	let fhLegacy: FileHandle | undefined = undefined;
	let fhModern: FileHandle | undefined = undefined;
	try {
		console.log(`Comparing legacy file ${legacyPath} to modern file ${modernPath}`);

		fhLegacy = await fs.open(legacyPath);
		fhModern = await fs.open(modernPath);

		const iterLegacy = fhLegacy.readLines()[Symbol.asyncIterator]();
		const iterModern = fhModern.readLines()[Symbol.asyncIterator]();

		// Skip '; processed by...' line in modern
		let modern = await iterModern.next();
		expect(modern.value).to.startWith('; processed by RatOS');

		let lineNumber = 2;

		while (true) {
			let legacy = await iterLegacy.next();
			modern = await iterModern.next();

			++lineNumber;

			if (modern.done) {
				expect(legacy.value).to.startWith('; processed by RatOS');
				break;
			}

			expect(legacy.done).toBeFalsy();

			// Work around the double-commenting bug in legacy gcode.
			const legacyLine = legacy.value.startsWith(
				'; Removed by RatOS post processor: ; Removed by RatOS post processor: ',
			)
				? legacy.value.substring('; Removed by RatOS post processor: '.length)
				: legacy.value;
			expect(modern.value.trimEnd()).to.equal(legacyLine.trimEnd(), `at line ${lineNumber}`);
		}

		console.log(`  ${lineNumber} lines compared ok.`);
	} finally {
		fhLegacy?.close();
		fhModern?.close();
	}
}

describe('other', async () => {
	test('G2/G3 arcs are not supported', async () => {
		await expect(
			async () =>
				await processToNullWithoutBookmarkProcessing(path.join(__dirname, 'fixtures', 'other', 'has_arcs_ps.gcode')),
		).rejects.toThrow(/arcs.*not.*supported/);
	});

	test('processing can be cancelled', async () => {
		await expect(async () =>
			processToNullWithoutBookmarkProcessing(
				path.join(__dirname, 'fixtures', 'slicer_output', 'SS_IDEX_MultiColor_WipeTower.gcode'),
				AbortSignal.timeout(100),
			),
		).rejects.toThrow(/timeout/);
	});
});

// For now, removing the RMMU variant tests, as Helge has a separate unreleased processor for this,
// so testing is pointless for now.
describe('legacy equivalence', { timeout: 60000 }, async () => {
	test.each(await glob('**/*.gcode', { cwd: path.join(__dirname, 'fixtures', 'slicer_output') }))(
		'%s',
		async (fixtureFile) => {
			const outputDir = path.join(__dirname, 'fixtures', 'output');
			fs.mkdir(outputDir, { recursive: true });
			const outputPath = path.join(outputDir, fixtureFile);

			console.log(`   input: ${fixtureFile}\n  output: ${outputPath}`);
			let fh: FileHandle | undefined = undefined;
			try {
				fh = await fs.open(outputPath, 'w');
				const gcodeProcessor = new GCodeProcessor(true, false, false);
				const encoder = new BookmarkingBufferEncoder();

				await pipeline(
					createReadStream(path.join(__dirname, 'fixtures', 'slicer_output', fixtureFile)),
					split(),
					gcodeProcessor,
					encoder,
					createWriteStream('|notused|', { fd: fh.fd, highWaterMark: 256 * 1024, autoClose: false }),
				);

				await gcodeProcessor.processBookmarks(encoder, (bm, line) => replaceBookmarkedGcodeLine(fh!, bm, line));
			} finally {
				try {
					await fh?.close();
				} catch {}
			}

			const legacyPath = path.join(__dirname, 'fixtures', 'transformed_legacy', fixtureFile);

			await legacyAndModernGcodeFilesAreEquivalent(legacyPath, outputPath);
		},
	);
});
