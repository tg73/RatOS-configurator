import { existsSync, createReadStream, createWriteStream, write, readFileSync } from 'fs';
import { copyFile, readFile, unlink } from 'fs/promises';
import { EOL } from 'os';
import { createInterface } from 'readline';
import { getLogger } from '@/server/helpers/logger';

export const getScriptRoot = () => {
	// This is ... not great.. come up with something better
	return process.env.RATOS_SCRIPT_DIR ?? __dirname.split('configurator/')[0] + 'configurator/scripts/';
};

/**
 * Replaces objects in a file with new objects.
 * @param filePath Path to the file to replace in
 * @param searchOrReplacer  String or RegExp to search for, or a function that takes a line and returns a new line, if null the line will be removed.
 * @param replace String to replace with, or null to remove the line.
 * @returns Number of lines changed
 */
export const replaceInFileByLine = async (
	filePath: string,
	searchOrReplacer: string | RegExp | ((line: string, lineNumber: number) => string | null),
	replace?: string | null,
) => {
	if (!existsSync(filePath)) {
		throw new Error('File does not exist: ' + filePath);
	}
	const fileStream = createReadStream(filePath, { highWaterMark: 1 * 1024 * 1024 });
	const writeStream = createWriteStream(filePath + '.tmp', { flags: 'w' });

	const rl = createInterface({
		input: fileStream,
		crlfDelay: Infinity,
	});
	const rlClosed = new Promise((resolve, reject) => {
		rl.on('close', () => {
			resolve(null);
		});
	});
	let linesChanged = 0;
	let linesDeleted = 0;
	let lineNumber = 0;
	try {
		for await (const line of rl) {
			lineNumber++;
			let newLine: string | null = line;
			if (searchOrReplacer instanceof Function) {
				newLine = searchOrReplacer(line, lineNumber);
			} else if (replace === null) {
				if (searchOrReplacer instanceof RegExp ? line.match(searchOrReplacer) : line.includes(searchOrReplacer)) {
					newLine = null;
				}
			} else if (replace == null) {
				getLogger().warn(`replaceInFileByLine (${filePath}): replacer wasn't provided, writing line as is`);
			} else {
				newLine = line.replace(searchOrReplacer, replace);
			}
			if (newLine !== null) {
				writeStream.write(newLine + EOL);
				if (newLine !== line) {
					linesChanged++;
				}
			} else {
				linesDeleted++;
			}
		}
	} catch (e) {
		getLogger().error(
			`replaceInFileByLine (${filePath}): error encountered during replace operation, original file will not be changed. ${e instanceof Error ? e.message : e instanceof String ? e : 'Unknown error'}`,
		);
		fileStream.destroy();
		writeStream.destroy();
		throw e;
	} finally {
		rl.close();
		await rlClosed;
		await new Promise((resolve, reject) => {
			writeStream.close((err) => {
				if (err) {
					throw reject(err);
				}
				resolve(null);
			});
		});
		await new Promise((resolve, reject) => {
			fileStream.close((err) => {
				if (err) {
					throw reject(err);
				}
				resolve(null);
			});
		});
	}
	if (linesChanged + linesDeleted > 0) {
		await copyFile(filePath + '.tmp', filePath);
	}
	await unlink(filePath + '.tmp');
	return { linesChanged, linesDeleted, linesTotal: lineNumber };
};

/**
 * Searches for a string or regex in a file and returns the line number.
 * @param filePath Path to the file to search in
 * @param search String or RegExp to search for
 * @returns Line number of the first match, or false if no match
 */
export const searchFileByLine = async (filePath: string, search: string | RegExp): Promise<number | false> => {
	if (!existsSync(filePath)) {
		throw new Error('File does not exist: ' + filePath);
	}
	const fileStream = createReadStream(filePath);

	const rl = createInterface({
		input: fileStream,
		crlfDelay: Infinity,
	});
	let result: number | false = false;
	let lineNumber = 0;
	for await (const line of rl) {
		if (result) continue;
		lineNumber++;
		if (search instanceof RegExp ? line.match(search) : line.includes(search)) {
			result = lineNumber;
		}
	}
	await new Promise((resolve, reject) => {
		fileStream.close((err) => {
			if (err) {
				throw reject(err);
			}
			resolve(null);
		});
	});
	return result;
};

/**
 * Extracts lines from a file.
 * @param filePath Path to the file to extract from
 * @param start Line number to start from
 * @param end Line number to end at
 * @returns Extracted lines
 */
export const extractLinesFromFile = async (filePath: string, start: number, end?: number) => {
	if (!existsSync(filePath)) {
		throw new Error('File does not exist: ' + filePath);
	}
	const fileStream = createReadStream(filePath);

	const rl = createInterface({
		input: fileStream,
		crlfDelay: Infinity,
	});
	let result: string[] = [];
	let lineNumber = 0;
	for await (const line of rl) {
		lineNumber++;
		if (lineNumber >= start && lineNumber <= (end ?? Infinity)) {
			result.push(line);
		}
	}
	await new Promise((resolve, reject) => {
		fileStream.close((err) => {
			if (err) {
				throw reject(err);
			}
			resolve(null);
		});
	});
	return result.join('\n');
};

/**
 * Small text-based INI section updater.
 *
 * Exports:
 * - replaceOrAddIniSections(content, updates) -> string
 * - replaceOrAddIniSectionsFromFile(filePath, updates) -> Promise<string>
 *
 * Behavior:
 * - For each update in `updates` (applied in order):
 *   - Find the first existing section whose header matches the requested section name.
 *     Matching rules:
 *       * Exact match of header inner text, OR
 *       * Header inner text starts with `sectionName` followed by a space (so `[board_pins foo]`
 *         will match `board_pins` when you pass "board_pins").
 *   - If found: replace that section's body with the provided body (keep the original header line).
 *     Remove any later duplicate sections that would have matched the same section name.
 *   - If not found: append `[sectionName]` and the body to EOF.
 * - Preserves original newline style (CRLF vs LF) based on the provided content (or uses '\n' if empty).
 * - Does not write to disk.
 */
export type IniUpdate = { section: string; body: string };

/**
 * Replace or add multiple INI sections inside a content string.
 * @param content The original file content (may be empty).
 * @param updates Array of { section, body } pairs to apply in order.
 * @returns Modified content as a string (does not write to disk).
 */
export function replaceOrAddIniSections(content: string, updates: IniUpdate[]): string {
	// Preserve newline style (CRLF vs LF). Default to '\n'.
	const newline = content.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
	const normContent = content.replace(/\r\n/g, '\n');

	// Find all section headers with positions.
	const headerRegex = /^\[([^\]]+)\].*$/gm;
	type Section = { headerLine: string; headerInner: string; start: number; end: number };
	const headerPositions: { idx: number; inner: string; headerLine: string }[] = [];

	let m: RegExpExecArray | null;
	while ((m = headerRegex.exec(normContent))) {
		const idx = m.index;
		// normalize inner header text: trim and collapse multiple whitespace to a single space
		const inner = m[1].trim().replace(/\s{2,}/g, ' ');

		// capture the whole header line (in case there are trailing comments)
		const rest = normContent.slice(idx);
		const headerLineMatch = rest.match(/^[^\n]*/);
		const headerLine = headerLineMatch ? headerLineMatch[0] : `[${inner}]`;
		headerPositions.push({ idx, inner, headerLine });
	}

	// If there are no sections, just append all updates in order.
	if (headerPositions.length === 0) {
		let out = normContent;
		// ensure trailing newline before appends
		if (out.length && !out.endsWith('\n')) out += '\n';
		// Determine the final body for each section (last-wins), but preserve the order of first appearance
		const nameToBody = new Map<string, string>();
		const order: string[] = [];
		for (const u of updates) {
			const name = u.section;
			if (!nameToBody.has(name)) order.push(name);
			nameToBody.set(name, u.body.replace(/\r\n/g, '\n'));
		}
		for (const name of order) {
			const body = nameToBody.get(name) ?? '';
			out += `[${name}]` + '\n' + body;
			if (!out.endsWith('\n')) out += '\n';
			out += '\n';
		}
		return newline === '\r\n' ? out.replace(/\n/g, '\r\n') : out;
	}

	// Build sections array (start/end slices)
	const sections: Section[] = [];
	for (let i = 0; i < headerPositions.length; i++) {
		const start = headerPositions[i].idx;
		const end = i + 1 < headerPositions.length ? headerPositions[i + 1].idx : normContent.length;
		sections.push({
			headerLine: headerPositions[i].headerLine,
			headerInner: headerPositions[i].inner,
			start,
			end,
		});
	}

	// Prelude = content before first section
	const prelude = normContent.slice(0, sections[0].start);

	// Helper: header matching rule
	const headerMatches = (headerInner: string, requested: string) => {
		return headerInner === requested;
	};

	// Determine first matching index for each unique update name (first occurrence only)
	// and capture the last body provided for that name (last-wins for body)
	const nameToFirstIndex = new Map<string, number | null>();
	const nameToBody = new Map<string, string>();
	const orderOfNames: string[] = []; // order of first appearance in updates

	for (const u of updates) {
		const name = u.section;
		// record order of first appearance
		if (!nameToBody.has(name)) orderOfNames.push(name);
		// always set body to last provided
		nameToBody.set(name, u.body.replace(/\r\n/g, '\n'));
		if (!nameToFirstIndex.has(name)) {
			let found: number | null = null;
			for (let i = 0; i < sections.length; i++) {
				if (headerMatches(sections[i].headerInner, name)) {
					found = i;
					break;
				}
			}
			nameToFirstIndex.set(name, found);
		}
	}

	// Build set of section indexes to skip (duplicates of matched names)
	const skipIndex = new Set<number>();
	// Map section index -> name (for those indices that are the first match)
	const indexToName = new Map<number, string>();

	for (const [name, idx] of nameToFirstIndex.entries()) {
		if (idx == null) continue;
		// mark all other sections matching this name as skip
		for (let i = 0; i < sections.length; i++) {
			if (i === idx) continue;
			if (headerMatches(sections[i].headerInner, name)) skipIndex.add(i);
		}
		indexToName.set(idx, name);
	}

	// Build output: prelude + processed sections (replacing bodies where needed)
	let out = prelude;

	for (let i = 0; i < sections.length; i++) {
		if (skipIndex.has(i)) continue; // remove duplicates
		const nameForThis = indexToName.get(i) ?? null;
		if (nameForThis) {
			// Replace body for this section with the final body for the name
			const originalSlice = normContent.slice(sections[i].start, sections[i].end);

			// Extract just the body content from the original section (everything after header line)
			const headerEndIdx = originalSlice.indexOf('\n');
			const originalBodyWithTrailing = headerEndIdx >= 0 ? originalSlice.slice(headerEndIdx + 1) : '';

			// Get the new body (normalized to LF)
			const newBody = nameToBody.get(nameForThis) ?? '';

			// Compare just the meaningful body content (strip trailing whitespace for comparison)
			const originalBodyTrimmed = originalBodyWithTrailing.replace(/\s+$/, '');
			const newBodyTrimmed = newBody.replace(/\s+$/, '');

			// Write the header line
			out += sections[i].headerLine + '\n';

			// If body content is identical, preserve original exactly (including trailing whitespace/comments)
			if (newBodyTrimmed === originalBodyTrimmed) {
				out += originalBodyWithTrailing;
			} else {
				// Body changed: use new body and ensure it ends with newline
				out += newBody;
				if (!out.endsWith('\n')) out += '\n';
			}
		} else {
			// copy original section slice exactly as-is
			const slice = normContent.slice(sections[i].start, sections[i].end);
			out += slice;
		}
	}

	// Append any names that had no existing section (in order of first appearance among updates)
	for (const name of orderOfNames) {
		const idx = nameToFirstIndex.get(name);
		if (idx == null) {
			out += `[${name}]\n`;
			out += nameToBody.get(name) ?? '';
			if (!out.endsWith('\n')) out += '\n';
			out += '\n';
		}
	}

	return newline === '\r\n' ? out.replace(/\n/g, '\r\n') : out;
}

/**
 * Read file (if exists), apply replaceOrAddIniSections, return new content.
 * Does NOT write to disk.
 * @param filePath Path to file. If file is missing, treated as empty.
 * @param updates Array of { section, body } pairs.
 */
export async function replaceOrAddIniSectionsFromFile(filePath: string, updates: IniUpdate[]): Promise<string> {
	let content = '';
	try {
		content = await readFile(filePath, 'utf8');
	} catch (e: any) {
		if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) {
			content = '';
		} else {
			throw e;
		}
	}
	return replaceOrAddIniSections(content, updates);
}

/**
 * Read file (if exists), apply replaceOrAddIniSections, return new content.
 * Does NOT write to disk. Synchronous version of replaceOrAddIniSectionsFromFile.
 * @param filePath Path to file. If file is missing, treated as empty.
 * @param updates Array of { section, body } pairs.
 */
export function replaceOrAddIniSectionsFromFileSync(filePath: string, updates: IniUpdate[]): string {
	let content = '';
	try {
		if (existsSync(filePath)) {
			content = readFileSync(filePath, 'utf8');
		} else {
			content = '';
		}
	} catch (e: any) {
		if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) {
			content = '';
		} else {
			throw e;
		}
	}
	return replaceOrAddIniSections(content, updates);
}
