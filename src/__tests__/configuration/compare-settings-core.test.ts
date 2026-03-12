/**
 * Unit tests for compareSettingsCore.
 *
 * compareSettingsCore receives two FilesToWrite arrays (old config and new config)
 * and a base path, then categorises every file into one of four states:
 *   - 'created'   – file is new in newFiles (not in oldFiles, or not on disk)
 *   - 'removed'   – file was in oldFiles and existed on disk but is absent from newFiles
 *   - 'changed'   – file exists in both but content differs, or lastSavedContent reveals a drift
 *   - 'unchanged' – file exists in both and content is identical
 *
 * The tests do NOT assume the implementation is correct; they pin observable
 * behaviour so regressions are caught.
 *
 * External I/O dependencies are mocked:
 *   - fs/promises writeFile  (no real temp-file writes)
 *   - child_process exec     (no real git-diff calls)
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── Hoisted mocks (must be first, before any import) ────────────────────────
const { mockWriteFile, mockExec } = vi.hoisted(() => {
	const mockWriteFile = vi.fn().mockResolvedValue(undefined);
	const MOCK_DIFF = 'diff --git a/file b/file\n@@ -0,0 +1 @@\n+content\n';
	const mockExec = vi.fn((cmd: string, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
		callback(null, MOCK_DIFF, '');
	});
	return { mockWriteFile, mockExec };
});

vi.mock('fs/promises', async (importOriginal) => {
	const actual = await importOriginal<typeof import('fs/promises')>();
	return { ...actual, writeFile: mockWriteFile };
});

vi.mock('child_process', () => ({ exec: mockExec }));

// ─── Subject under test ───────────────────────────────────────────────────────
import { compareSettingsCore } from '@/server/routers/printer';

// ─── Constants ───────────────────────────────────────────────────────────────
const BASE_PATH = '/tmp/test-klipper-config';
const MOCK_DIFF = 'diff --git a/file b/file\n@@ -0,0 +1 @@\n+content\n';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convenience factory that fills in required fields with sensible defaults.
 * Omitting 'diskContent' defaults to null; callers should set it explicitly
 * when the test cares about on-disk content vs generated content.
 */
function makeFile(opts: {
	fileName: string;
	content: string;
	overwrite?: boolean;
	exists?: boolean;
	diskContent?: string | null;
	lastSavedContent?: string | null;
	order?: number;
}) {
	return {
		overwrite: false,
		exists: true,
		diskContent: null as string | null,
		lastSavedContent: null as string | null,
		...opts,
	};
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('compareSettingsCore', () => {
	beforeEach(() => {
		mockWriteFile.mockClear();
		mockExec.mockClear();
		// Default: exec succeeds with a non-empty diff (git exits 1 but stdout non-empty is normal)
		mockExec.mockImplementation(
			(cmd: string, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
				callback(null, MOCK_DIFF, '');
			},
		);
	});

	// =========================================================================
	//  EMPTY INPUTS
	// =========================================================================
	describe('empty inputs', () => {
		it('returns an empty array when both old and new files are empty', async () => {
			const result = await compareSettingsCore([], [], BASE_PATH);
			expect(result).toEqual([]);
		});

		it('returns created entries when oldFiles is empty and newFiles has entries', async () => {
			const newFiles = [makeFile({ fileName: 'RatOS.cfg', content: 'x', exists: false, diskContent: null })];
			const result = await compareSettingsCore([], newFiles, BASE_PATH);
			expect(result).toHaveLength(1);
			expect(result[0].state).toBe('created');
		});

		it('returns removed entries when newFiles is empty and oldFiles has on-disk files', async () => {
			const oldFiles = [makeFile({ fileName: 'old.cfg', content: 'x', exists: true, diskContent: 'x' })];
			const result = await compareSettingsCore(oldFiles, [], BASE_PATH);
			expect(result).toHaveLength(1);
			expect(result[0].state).toBe('removed');
		});

		it('returns empty array when newFiles is empty and oldFiles has only non-existent files', async () => {
			const oldFiles = [makeFile({ fileName: 'ghost.cfg', content: 'x', exists: false, diskContent: null })];
			const result = await compareSettingsCore(oldFiles, [], BASE_PATH);
			expect(result).toHaveLength(0);
		});
	});

	// =========================================================================
	//  CREATED STATE
	// =========================================================================
	describe('state: created', () => {
		describe('which files are classified as created', () => {
			it('classifies a new file absent from oldFiles that does not exist on disk as created', async () => {
				const newFile = makeFile({ fileName: 'new.cfg', content: 'content', exists: false, diskContent: null });
				const result = await compareSettingsCore([], [newFile], BASE_PATH);
				expect(result[0].state).toBe('created');
				expect(result[0].fileName).toBe('new.cfg');
				expect(result[0].diff).toBe(MOCK_DIFF);
				expect(result[0].diskContent).toBeNull();
				expect(result[0].exists).toBe(false);
			});

			it('classifies a new file absent from oldFiles that already exists on disk as created', async () => {
				// File existed on disk before the configurator was involved
				const newFile = makeFile({ fileName: 'existing.cfg', content: 'new', exists: true, diskContent: 'old' });
				const result = await compareSettingsCore([], [newFile], BASE_PATH);
				expect(result[0].state).toBe('created');
				expect(result[0].diff).toBe(MOCK_DIFF);
				expect(result[0].diskContent).toBe('old');
				expect(result[0].exists).toBe(true);
			});

			it('classifies a file as created when exists=false in newFiles even if it is present in oldFiles', async () => {
				// The file was tracked before but is now reported as missing from disk
				const oldFile = makeFile({ fileName: 'file.cfg', content: 'old', exists: true, diskContent: 'old' });
				const newFile = makeFile({ fileName: 'file.cfg', content: 'new', exists: false, diskContent: null });
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				const file = result.find((f) => f.fileName === 'file.cfg');
				expect(file?.state).toBe('created');
				expect(file?.diff).toBe(MOCK_DIFF);
				expect(file?.diskContent).toBeNull();
				expect(file?.exists).toBe(false);
			});

			it('classifies a file as created when exists=false in newFiles and also absent from oldFiles', async () => {
				const newFile = makeFile({ fileName: 'brand-new.cfg', content: 'x', exists: false, diskContent: null });
				const result = await compareSettingsCore([], [newFile], BASE_PATH);
				expect(result[0].state).toBe('created');
			});
		});

		describe('diff for created files', () => {
			it('attaches the diff output returned by git for a created file', async () => {
				const newFile = makeFile({ fileName: 'file.cfg', content: 'content', exists: false, diskContent: null });
				const result = await compareSettingsCore([], [newFile], BASE_PATH);
				expect(result[0].diff).toBe(MOCK_DIFF);
			});

			it('rejects when exec returns an empty stdout with no error for created files', async () => {
				mockExec.mockImplementation((_cmd: string, cb: Function) => cb(null, '', ''));
				const newFile = makeFile({ fileName: 'file.cfg', content: 'x', exists: false, diskContent: null });
				await expect(compareSettingsCore([], [newFile], BASE_PATH)).rejects.toThrow();
			});

			it('rejects when exec returns empty stdout with an error for created files', async () => {
				mockExec.mockImplementation((_cmd: string, cb: Function) => cb(new Error('git error'), '', 'fatal error'));
				const newFile = makeFile({ fileName: 'file.cfg', content: 'x', exists: false, diskContent: null });
				await expect(compareSettingsCore([], [newFile], BASE_PATH)).rejects.toThrow();
			});

			it('resolves with diff when exec signals an error but stdout is non-empty (git exits 1 when diffs exist)', async () => {
				mockExec.mockImplementation((_cmd: string, cb: Function) => cb(new Error('exit 1'), MOCK_DIFF, ''));
				const newFile = makeFile({ fileName: 'file.cfg', content: 'x', exists: false, diskContent: null });
				const result = await compareSettingsCore([], [newFile], BASE_PATH);
				expect(result[0].diff).toBe(MOCK_DIFF);
			});
		});

		describe('field propagation for created files', () => {
			it('preserves overwrite=true from the newFile entry', async () => {
				const newFile = makeFile({
					fileName: 'f.cfg',
					content: 'x',
					exists: false,
					diskContent: null,
					overwrite: true,
				});
				const result = await compareSettingsCore([], [newFile], BASE_PATH);
				expect(result[0].overwrite).toBe(true);
			});

			it('preserves exists=false from the newFile entry', async () => {
				const newFile = makeFile({ fileName: 'f.cfg', content: 'x', exists: false, diskContent: null });
				const result = await compareSettingsCore([], [newFile], BASE_PATH);
				expect(result[0].exists).toBe(false);
			});

			it('preserves exists=true (on-disk) for a created file that exists on disk', async () => {
				const newFile = makeFile({ fileName: 'f.cfg', content: 'x', exists: true, diskContent: 'old' });
				const result = await compareSettingsCore([], [newFile], BASE_PATH);
				expect(result[0].exists).toBe(true);
			});

			it('sets diskContent to null when newFile.diskContent is null', async () => {
				const newFile = makeFile({ fileName: 'f.cfg', content: 'x', exists: false, diskContent: null });
				const result = await compareSettingsCore([], [newFile], BASE_PATH);
				expect(result[0].diskContent).toBeNull();
			});

			it('propagates diskContent from newFile when the file exists on disk', async () => {
				const newFile = makeFile({ fileName: 'f.cfg', content: 'x', exists: true, diskContent: 'disk-content' });
				const result = await compareSettingsCore([], [newFile], BASE_PATH);
				expect(result[0].diskContent).toBe('disk-content');
			});

			it('propagates the order field', async () => {
				const newFile = makeFile({ fileName: 'f.cfg', content: 'x', exists: false, diskContent: null, order: 7 });
				const result = await compareSettingsCore([], [newFile], BASE_PATH);
				expect(result[0].order).toBe(7);
			});

			it('does not include the content field in the result (it is stripped)', async () => {
				const newFile = makeFile({ fileName: 'f.cfg', content: 'x', exists: false, diskContent: null });
				const result = await compareSettingsCore([], [newFile], BASE_PATH);
				expect('content' in result[0]).toBe(false);
			});
		});
	});

	// =========================================================================
	//  REMOVED STATE
	// =========================================================================
	describe('state: removed', () => {
		describe('which files are classified as removed', () => {
			it('classifies as removed a file in oldFiles with exists=true that is absent from newFiles', async () => {
				const oldFile = makeFile({ fileName: 'gone.cfg', content: 'x', exists: true, diskContent: 'x' });
				const result = await compareSettingsCore([oldFile], [], BASE_PATH);
				expect(result).toHaveLength(1);
				expect(result[0].state).toBe('removed');
				expect(result[0].fileName).toBe('gone.cfg');
				expect(result[0].diff).toBe(MOCK_DIFF);
				expect(result[0].diskContent).toBe('x');
				expect(result[0].exists).toBe(true);
			});

			it('does NOT classify crowsnest.conf as removed even when it would otherwise qualify', async () => {
				const oldFile = makeFile({
					fileName: 'crowsnest.conf',
					content: 'crowsnest config',
					exists: true,
					diskContent: 'crowsnest config',
				});
				const result = await compareSettingsCore([oldFile], [], BASE_PATH);
				expect(result.find((f) => f.fileName === 'crowsnest.conf')).toBeUndefined();
				expect(result).toHaveLength(0);
			});

			it('does NOT classify a file in oldFiles with exists=false as removed', async () => {
				const oldFile = makeFile({ fileName: 'ghost.cfg', content: 'x', exists: false, diskContent: null });
				const result = await compareSettingsCore([oldFile], [], BASE_PATH);
				expect(result.find((f) => f.state === 'removed')).toBeUndefined();
			});

			it('does NOT classify a file as removed if it also appears in newFiles', async () => {
				const oldFile = makeFile({ fileName: 'shared.cfg', content: 'old', exists: true, diskContent: 'old' });
				const newFile = makeFile({ fileName: 'shared.cfg', content: 'new', exists: true, diskContent: 'old' });
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result.find((f) => f.state === 'removed')).toBeUndefined();
			});

			it('classifies multiple removed files correctly', async () => {
				const oldFiles = [
					makeFile({ fileName: 'a.cfg', content: 'a', exists: true, diskContent: 'a' }),
					makeFile({ fileName: 'b.cfg', content: 'b', exists: true, diskContent: 'b' }),
				];
				const result = await compareSettingsCore(oldFiles, [], BASE_PATH);
				expect(result.filter((f) => f.state === 'removed')).toHaveLength(2);
			});
		});

		describe('diff for removed files', () => {
			it('attaches a diff for removed files', async () => {
				const oldFile = makeFile({ fileName: 'gone.cfg', content: 'x', exists: true, diskContent: 'x' });
				const result = await compareSettingsCore([oldFile], [], BASE_PATH);
				expect(result[0].diff).toBe(MOCK_DIFF);
			});

			it('rejects when exec produces empty stdout for a removed file', async () => {
				mockExec.mockImplementation((_cmd: string, cb: Function) => cb(null, '   ', ''));
				const oldFile = makeFile({ fileName: 'gone.cfg', content: 'x', exists: true, diskContent: 'x' });
				await expect(compareSettingsCore([oldFile], [], BASE_PATH)).rejects.toThrow();
			});
		});

		describe('field propagation for removed files', () => {
			it('propagates diskContent (from oldFile) for removed files', async () => {
				const oldFile = makeFile({
					fileName: 'gone.cfg',
					content: 'x',
					exists: true,
					diskContent: 'actual-disk-content',
				});
				const result = await compareSettingsCore([oldFile], [], BASE_PATH);
				expect(result[0].diskContent).toBe('actual-disk-content');
			});

			it('sets diskContent to null when oldFile.diskContent is null', async () => {
				const oldFile = makeFile({ fileName: 'gone.cfg', content: 'x', exists: true, diskContent: null });
				const result = await compareSettingsCore([oldFile], [], BASE_PATH);
				expect(result[0].diskContent).toBeNull();
			});

			it('propagates overwrite from oldFile', async () => {
				const oldFile = makeFile({
					fileName: 'gone.cfg',
					content: 'x',
					exists: true,
					diskContent: 'x',
					overwrite: true,
				});
				const result = await compareSettingsCore([oldFile], [], BASE_PATH);
				expect(result[0].overwrite).toBe(true);
			});

			it('propagates exists=true from oldFile', async () => {
				const oldFile = makeFile({ fileName: 'gone.cfg', content: 'x', exists: true, diskContent: 'x' });
				const result = await compareSettingsCore([oldFile], [], BASE_PATH);
				expect(result[0].exists).toBe(true);
			});

			it('does not include content field in the removed file result', async () => {
				const oldFile = makeFile({ fileName: 'gone.cfg', content: 'x', exists: true, diskContent: 'x' });
				const result = await compareSettingsCore([oldFile], [], BASE_PATH);
				expect('content' in result[0]).toBe(false);
			});
		});
	});

	// =========================================================================
	//  CHANGED STATE
	// =========================================================================
	describe('state: changed', () => {
		describe('classification: content differs between old and new', () => {
			it('classifies a file as changed when content differs and exists=true in newFile', async () => {
				const oldFile = makeFile({ fileName: 'f.cfg', content: 'old', exists: true, diskContent: 'old' });
				const newFile = makeFile({ fileName: 'f.cfg', content: 'new', exists: true, diskContent: 'old' });
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result).toHaveLength(1);
				expect(result[0].state).toBe('changed');
				expect(result[0].diff).toBe(MOCK_DIFF);
				expect(result[0].changedOnDisk).toBe(false); // diskContent === generated content before the change
				expect(result[0].changedFromConfig).toBe(true);
			});

			it('does NOT classify a file as changed when exists=false in newFile (forced to created)', async () => {
				const oldFile = makeFile({ fileName: 'f.cfg', content: 'old', exists: true, diskContent: 'old' });
				const newFile = makeFile({ fileName: 'f.cfg', content: 'new', exists: false, diskContent: null });
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].state).toBe('created');
			});
		});

		describe('classification: lastSavedContent introduces a change signal', () => {
			it('classifies as changed when content is identical old/new but lastSavedContent differs from oldFile.content', async () => {
				// The template generates the same output for both settings snapshots, but the
				// last-saved tracking file differs (e.g., a bug was fixed in a previous release).
				const sharedContent = 'generated content';
				const oldFile = makeFile({
					fileName: 'f.cfg',
					content: sharedContent,
					exists: true,
					diskContent: sharedContent,
				});
				const newFile = makeFile({
					fileName: 'f.cfg',
					content: sharedContent,
					exists: true,
					diskContent: sharedContent,
					lastSavedContent: 'previously-saved-different-content',
				});
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].state).toBe('changed');
				// skipDiff fires because oldFile.diskContent === newFile.content (both sharedContent)
				expect(result[0].diff).toBeNull();
				expect(result[0].changedOnDisk).toBe(false); // disk matched what was last generated
				expect(result[0].changedFromConfig).toBe(true); // lastSavedContent reveals drift
			});

			it('classifies as unchanged when lastSavedContent is null and content is the same', async () => {
				const content = 'same';
				const oldFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content });
				const newFile = makeFile({
					fileName: 'f.cfg',
					content,
					exists: true,
					diskContent: content,
					lastSavedContent: null,
				});
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].state).toBe('unchanged');
			});

			it('classifies as unchanged when lastSavedContent matches oldFile.content and content is the same', async () => {
				const content = 'same';
				const oldFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content });
				const newFile = makeFile({
					fileName: 'f.cfg',
					content,
					exists: true,
					diskContent: content,
					lastSavedContent: content, // matches oldFile.content → no drift
				});
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].state).toBe('unchanged');
			});
		});

		describe('diff generation – normal changed file', () => {
			it('generates a diff when oldFile exists on disk and its diskContent differs from new content', async () => {
				const oldFile = makeFile({ fileName: 'f.cfg', content: 'old', exists: true, diskContent: 'old' });
				const newFile = makeFile({ fileName: 'f.cfg', content: 'new', exists: true, diskContent: 'old' });
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].state).toBe('changed');
				expect(result[0].diff).toBe(MOCK_DIFF);
				expect(result[0].changedOnDisk).toBe(false);
				expect(result[0].changedFromConfig).toBe(true);
			});

			it('generates a diff using a temp file when oldFile does not exist on disk', async () => {
				// The old configuration represents a file that was generated but never written to disk.
				const oldFile = makeFile({ fileName: 'f.cfg', content: 'old', exists: false, diskContent: null });
				const newFile = makeFile({ fileName: 'f.cfg', content: 'new', exists: true, diskContent: null });
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].state).toBe('changed');
				expect(result[0].diff).toBe(MOCK_DIFF);
				// oldFile.diskContent (null) !== oldFile.content ('old') → changedOnDisk=true
				expect(result[0].changedOnDisk).toBe(true);
				expect(result[0].changedFromConfig).toBe(true);
				expect(result[0].diskContent).toBeNull();
				// writeFile must have been called to materialise the old content in /tmp
				expect(mockWriteFile).toHaveBeenCalled();
			});
		});

		describe('skipDiff – user coincidentally made the same changes as the new generated content', () => {
			/**
			 * Special scenario (explicitly demanded by the test specification):
			 *
			 * The new config generates a file with content "X".
			 * The user has manually edited the on-disk file so it also contains "X".
			 * The last time RatOS saved this file it contained "OLD".
			 *
			 *   newFile.content     = "X"    (newly generated)
			 *   newFile.diskContent = "X"    (user happened to make the same edits)
			 *   newFile.lastSaved   = "OLD"  (what RatOS last wrote)
			 *   oldFile.content     = "OLD"  (what old settings generated)
			 *   oldFile.diskContent = "X"    (same physical file on disk)
			 *   oldFile.exists      = true
			 *
			 * Expected:
			 *   - state           = 'changed'  (the config DID change)
			 *   - diff            = null       (no diff needed; on-disk already matches new content)
			 *   - changedOnDisk   = true       (user had modified the file away from old generated)
			 *   - changedFromConfig = true     (the template generated a different file)
			 */
			it('covers all expected properties in the coincidental-match scenario', async () => {
				const newContent = 'new generated content';
				const oldContent = 'old generated content';
				const oldFile = makeFile({ fileName: 'f.cfg', content: oldContent, exists: true, diskContent: newContent });
				const newFile = makeFile({
					fileName: 'f.cfg',
					content: newContent,
					exists: true,
					diskContent: newContent,
					lastSavedContent: oldContent,
				});
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].state).toBe('changed');
				// skipDiff fires because oldFile.diskContent === newFile.content; no diff needed
				expect(result[0].diff).toBeNull();
				// The user had edited the file away from what oldFile generated
				expect(result[0].changedOnDisk).toBe(true);
				// The new settings produce different content than the old settings did
				expect(result[0].changedFromConfig).toBe(true);
				// diskContent is taken from newFile (the physical disk state)
				expect(result[0].diskContent).toBe(newContent);
			});

			it('does not call exec when skipDiff is triggered', async () => {
				const newContent = 'new';
				const oldFile = makeFile({ fileName: 'f.cfg', content: 'old', exists: true, diskContent: newContent });
				const newFile = makeFile({ fileName: 'f.cfg', content: newContent, exists: true, diskContent: newContent });
				await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(mockExec).not.toHaveBeenCalled();
			});

			it('skipDiff does NOT apply when oldFile.exists=false (temp file is always used in that path)', async () => {
				// Even if diskContent would coincidentally match, the skipDiff guard only runs when oldFile.exists=true
				const newContent = 'new content';
				const oldFile = makeFile({
					fileName: 'f.cfg',
					content: 'old',
					exists: false,
					diskContent: newContent, // coincidentally matches newContent but oldFile.exists=false
				});
				const newFile = makeFile({ fileName: 'f.cfg', content: newContent, exists: true, diskContent: newContent });
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].state).toBe('changed');
				expect(result[0].diff).toBe(MOCK_DIFF); // diff IS generated because no skipDiff
				// oldFile.diskContent (newContent) !== oldFile.content ('old') → changedOnDisk=true
				expect(result[0].changedOnDisk).toBe(true);
				expect(result[0].changedFromConfig).toBe(true);
			});
		});

		describe('changedOnDisk field', () => {
			it('is false when oldFile.diskContent === oldFile.content (file not edited by user)', async () => {
				const oldFile = makeFile({ fileName: 'f.cfg', content: 'gen', exists: true, diskContent: 'gen' });
				const newFile = makeFile({ fileName: 'f.cfg', content: 'new', exists: true, diskContent: 'gen' });
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].changedOnDisk).toBe(false);
			});

			it('is true when oldFile.diskContent !== oldFile.content (user edited the file)', async () => {
				const oldFile = makeFile({ fileName: 'f.cfg', content: 'gen', exists: true, diskContent: 'user-edited' });
				const newFile = makeFile({ fileName: 'f.cfg', content: 'new', exists: true, diskContent: 'user-edited' });
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].changedOnDisk).toBe(true);
			});
		});

		describe('changedFromConfig field', () => {
			it('is true when content differs between old and new', async () => {
				const oldFile = makeFile({ fileName: 'f.cfg', content: 'old', exists: true, diskContent: 'old' });
				const newFile = makeFile({ fileName: 'f.cfg', content: 'new', exists: true, diskContent: 'old' });
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].changedFromConfig).toBe(true);
			});

			it('is true when content is the same but lastSavedContent reveals drift', async () => {
				const content = 'same';
				const oldFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content });
				const newFile = makeFile({
					fileName: 'f.cfg',
					content,
					exists: true,
					diskContent: content,
					lastSavedContent: 'previously-saved',
				});
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].changedFromConfig).toBe(true);
			});
		});

		describe('field propagation for changed files', () => {
			it('propagates diskContent from newFile', async () => {
				const oldFile = makeFile({ fileName: 'f.cfg', content: 'old', exists: true, diskContent: 'v1' });
				const newFile = makeFile({ fileName: 'f.cfg', content: 'new', exists: true, diskContent: 'v1' });
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].diskContent).toBe('v1');
			});

			it('sets diskContent to null when newFile.diskContent is null', async () => {
				const oldFile = makeFile({ fileName: 'f.cfg', content: 'old', exists: true, diskContent: null });
				const newFile = makeFile({ fileName: 'f.cfg', content: 'new', exists: true, diskContent: null });
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].diskContent).toBeNull();
			});

			it('propagates overwrite from newFile', async () => {
				const oldFile = makeFile({
					fileName: 'f.cfg',
					content: 'old',
					exists: true,
					diskContent: 'old',
					overwrite: false,
				});
				const newFile = makeFile({
					fileName: 'f.cfg',
					content: 'new',
					exists: true,
					diskContent: 'old',
					overwrite: true,
				});
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].overwrite).toBe(true);
			});

			it('propagates order from newFile', async () => {
				const oldFile = makeFile({ fileName: 'f.cfg', content: 'old', exists: true, diskContent: 'old' });
				const newFile = makeFile({ fileName: 'f.cfg', content: 'new', exists: true, diskContent: 'old', order: 3 });
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].order).toBe(3);
			});

			it('does not include content field in the changed file result', async () => {
				const oldFile = makeFile({ fileName: 'f.cfg', content: 'old', exists: true, diskContent: 'old' });
				const newFile = makeFile({ fileName: 'f.cfg', content: 'new', exists: true, diskContent: 'old' });
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect('content' in result[0]).toBe(false);
			});
		});
	});

	// =========================================================================
	//  UNCHANGED STATE
	// =========================================================================
	describe('state: unchanged', () => {
		describe('which files are classified as unchanged', () => {
			it('classifies as unchanged when content is identical and lastSavedContent is null', async () => {
				const content = 'same';
				const oldFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content });
				const newFile = makeFile({
					fileName: 'f.cfg',
					content,
					exists: true,
					diskContent: content,
					lastSavedContent: null,
				});
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result).toHaveLength(1);
				expect(result[0].state).toBe('unchanged');
				expect(result[0].diff).toBeNull(); // disk matches generated content, no diff
				expect(result[0].changedOnDisk).toBe(false);
				expect(result[0].changedFromConfig).toBe(false);
			});

			it('classifies as unchanged when content is identical and lastSavedContent matches oldFile.content', async () => {
				const content = 'same';
				const oldFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content });
				const newFile = makeFile({
					fileName: 'f.cfg',
					content,
					exists: true,
					diskContent: content,
					lastSavedContent: content,
				});
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].state).toBe('unchanged');
				expect(result[0].diff).toBeNull(); // disk matches generated content, no diff
				expect(result[0].changedOnDisk).toBe(false);
				expect(result[0].changedFromConfig).toBe(false);
			});

			it('does NOT classify as unchanged when exists=false in newFile (goes to created)', async () => {
				const content = 'same';
				const oldFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content });
				const newFile = makeFile({ fileName: 'f.cfg', content, exists: false, diskContent: null });
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].state).toBe('created');
			});
		});

		describe('diff for unchanged files', () => {
			it('diff is null when disk content matches generated content (file untouched by user)', async () => {
				const content = 'generated';
				const oldFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content });
				const newFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content });
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].diff).toBeNull();
			});

			it('diff is non-null when oldFile.diskContent differs from oldFile.content (user modified the file)', async () => {
				// Config generates the same content as before, but the user changed the disk file.
				// A diff is shown to let the user see what they changed relative to what we'd generate.
				const content = 'generated';
				const oldFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: 'user-modified' });
				const newFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: 'user-modified' });
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].diff).toBe(MOCK_DIFF);
			});

			it('diff is non-null even when oldFile.exists=false but changedOnDisk is truthy', async () => {
				// Unusual: old tracked file was not on disk, but its diskContent differs from content
				const content = 'generated';
				const oldFile = makeFile({ fileName: 'f.cfg', content, exists: false, diskContent: 'some-other-content' });
				const newFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: 'some-other-content' });
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].state).toBe('unchanged');
				expect(result[0].diff).toBe(MOCK_DIFF);
			});

			it('does not call exec when disk content matches generated content for unchanged files', async () => {
				const content = 'same';
				const oldFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content });
				const newFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content });
				await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(mockExec).not.toHaveBeenCalled();
			});

			it('calls exec once when disk content differs (changedOnDisk) for unchanged files', async () => {
				const content = 'generated';
				const oldFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: 'edited' });
				const newFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: 'edited' });
				await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(mockExec).toHaveBeenCalledTimes(1);
			});
		});

		describe('changedOnDisk field for unchanged files', () => {
			it('is false when oldFile.diskContent matches oldFile.content', async () => {
				const content = 'gen';
				const oldFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content });
				const newFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content });
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].changedOnDisk).toBe(false);
			});

			it('is true when oldFile.diskContent differs from oldFile.content', async () => {
				const content = 'gen';
				const oldFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: 'edited' });
				const newFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: 'edited' });
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].changedOnDisk).toBe(true);
			});
		});

		describe('changedFromConfig field for unchanged files', () => {
			it('is false when both content matches and lastSavedContent is null', async () => {
				const content = 'gen';
				const oldFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content });
				const newFile = makeFile({
					fileName: 'f.cfg',
					content,
					exists: true,
					diskContent: content,
					lastSavedContent: null,
				});
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].changedFromConfig).toBe(false);
			});

			it('is false when content matches and lastSavedContent equals oldFile.content', async () => {
				const content = 'gen';
				const oldFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content });
				const newFile = makeFile({
					fileName: 'f.cfg',
					content,
					exists: true,
					diskContent: content,
					lastSavedContent: content,
				});
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].changedFromConfig).toBe(false);
			});
		});

		describe('field propagation for unchanged files', () => {
			it('propagates diskContent from newFile', async () => {
				const content = 'gen';
				const oldFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content });
				const newFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: 'on-disk-version' });
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].diskContent).toBe('on-disk-version');
			});

			it('propagates overwrite from newFile', async () => {
				const content = 'gen';
				const oldFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content });
				const newFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content, overwrite: true });
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect(result[0].overwrite).toBe(true);
			});

			it('does not include content field in the unchanged file result', async () => {
				const content = 'gen';
				const oldFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content });
				const newFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content });
				const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
				expect('content' in result[0]).toBe(false);
			});
		});
	});

	// =========================================================================
	//  MUTUAL EXCLUSION
	// =========================================================================
	describe('mutual exclusion of states', () => {
		it('a file appears in exactly one state category', async () => {
			const content = 'x';
			const oldFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content });
			const newFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content });
			const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
			expect(result).toHaveLength(1);
		});

		it('a file with content change appears exactly once as changed', async () => {
			const oldFile = makeFile({ fileName: 'f.cfg', content: 'old', exists: true, diskContent: 'old' });
			const newFile = makeFile({ fileName: 'f.cfg', content: 'new', exists: true, diskContent: 'old' });
			const result = await compareSettingsCore([oldFile], [newFile], BASE_PATH);
			expect(result).toHaveLength(1);
			expect(result[0].state).toBe('changed');
		});

		it('a file not in oldFiles but in newFiles appears exactly once as created', async () => {
			const newFile = makeFile({ fileName: 'f.cfg', content: 'x', exists: false, diskContent: null });
			const result = await compareSettingsCore([], [newFile], BASE_PATH);
			expect(result).toHaveLength(1);
			expect(result[0].state).toBe('created');
		});
	});

	// =========================================================================
	//  MIXED SCENARIOS
	// =========================================================================
	describe('mixed file states', () => {
		it('correctly handles created, removed, changed, and unchanged files simultaneously', async () => {
			const oldFiles = [
				makeFile({ fileName: 'unchanged.cfg', content: 'u', exists: true, diskContent: 'u' }),
				makeFile({ fileName: 'changed.cfg', content: 'old', exists: true, diskContent: 'old' }),
				makeFile({ fileName: 'removed.cfg', content: 'r', exists: true, diskContent: 'r' }),
			];
			const newFiles = [
				makeFile({ fileName: 'unchanged.cfg', content: 'u', exists: true, diskContent: 'u' }),
				makeFile({ fileName: 'changed.cfg', content: 'new', exists: true, diskContent: 'old' }),
				makeFile({ fileName: 'created.cfg', content: 'c', exists: false, diskContent: null }),
			];
			const result = await compareSettingsCore(oldFiles, newFiles, BASE_PATH);
			expect(result).toHaveLength(4);
			expect(result.find((f) => f.fileName === 'unchanged.cfg')?.state).toBe('unchanged');
			expect(result.find((f) => f.fileName === 'changed.cfg')?.state).toBe('changed');
			expect(result.find((f) => f.fileName === 'removed.cfg')?.state).toBe('removed');
			expect(result.find((f) => f.fileName === 'created.cfg')?.state).toBe('created');
		});

		it('handles the coincidental-match file alongside normally changed and unchanged files', async () => {
			const coincidentalNew = 'coincidentally same as disk';
			const coincidentalOld = 'was generated like this before';
			const oldFiles = [
				makeFile({
					fileName: 'coincidental.cfg',
					content: coincidentalOld,
					exists: true,
					diskContent: coincidentalNew,
				}),
				makeFile({ fileName: 'normal-changed.cfg', content: 'old-normal', exists: true, diskContent: 'old-normal' }),
				makeFile({ fileName: 'normal-unchanged.cfg', content: 'same', exists: true, diskContent: 'same' }),
			];
			const newFiles = [
				makeFile({
					fileName: 'coincidental.cfg',
					content: coincidentalNew,
					exists: true,
					diskContent: coincidentalNew,
					lastSavedContent: coincidentalOld,
				}),
				makeFile({
					fileName: 'normal-changed.cfg',
					content: 'new-normal',
					exists: true,
					diskContent: 'old-normal',
				}),
				makeFile({ fileName: 'normal-unchanged.cfg', content: 'same', exists: true, diskContent: 'same' }),
			];
			const result = await compareSettingsCore(oldFiles, newFiles, BASE_PATH);

			const coincidental = result.find((f) => f.fileName === 'coincidental.cfg');
			expect(coincidental?.state).toBe('changed');
			expect(coincidental?.diff).toBeNull();
			expect(coincidental?.changedOnDisk).toBe(true);
			expect(coincidental?.changedFromConfig).toBe(true);

			expect(result.find((f) => f.fileName === 'normal-changed.cfg')?.state).toBe('changed');
			expect(result.find((f) => f.fileName === 'normal-changed.cfg')?.diff).toBe(MOCK_DIFF);
			expect(result.find((f) => f.fileName === 'normal-unchanged.cfg')?.state).toBe('unchanged');
		});

		it('correctly excludes crowsnest.conf from removed while processing other removed files', async () => {
			const oldFiles = [
				makeFile({ fileName: 'crowsnest.conf', content: 'crow', exists: true, diskContent: 'crow' }),
				makeFile({ fileName: 'other.cfg', content: 'x', exists: true, diskContent: 'x' }),
			];
			const result = await compareSettingsCore(oldFiles, [], BASE_PATH);
			expect(result).toHaveLength(1);
			expect(result[0].fileName).toBe('other.cfg');
			expect(result[0].state).toBe('removed');
		});

		it('handles multiple new files when there are no old files (fresh install)', async () => {
			const newFiles = [
				makeFile({ fileName: 'RatOS.cfg', content: 'a', exists: false, diskContent: null, order: 0, overwrite: true }),
				makeFile({
					fileName: 'printer.cfg',
					content: 'b',
					exists: false,
					diskContent: null,
					order: 1,
					overwrite: false,
				}),
				makeFile({ fileName: 'extra.cfg', content: 'c', exists: false, diskContent: null }),
			];
			const result = await compareSettingsCore([], newFiles, BASE_PATH);
			expect(result).toHaveLength(3);
			result.forEach((f) => expect(f.state).toBe('created'));
		});

		it('handles multiple unchanged files', async () => {
			const files = Array.from({ length: 5 }, (_, i) =>
				makeFile({ fileName: `file-${i}.cfg`, content: `content-${i}`, exists: true, diskContent: `content-${i}` }),
			);
			const result = await compareSettingsCore(files, files, BASE_PATH);
			expect(result).toHaveLength(5);
			result.forEach((f) => expect(f.state).toBe('unchanged'));
		});
	});

	// =========================================================================
	//  SORTING
	// =========================================================================
	describe('sorting', () => {
		it('sorts by order property ascending', async () => {
			const newFiles = [
				makeFile({ fileName: 'b.cfg', content: 'b', exists: false, diskContent: null, order: 2 }),
				makeFile({ fileName: 'a.cfg', content: 'a', exists: false, diskContent: null, order: 1 }),
			];
			const result = await compareSettingsCore([], newFiles, BASE_PATH);
			expect(result[0].fileName).toBe('a.cfg');
			expect(result[1].fileName).toBe('b.cfg');
		});

		it('treats missing order as 9999 (sorts after files with explicit low order)', async () => {
			const newFiles = [
				makeFile({ fileName: 'no-order.cfg', content: 'n', exists: false, diskContent: null }),
				makeFile({ fileName: 'ordered.cfg', content: 'o', exists: false, diskContent: null, order: 0 }),
			];
			const result = await compareSettingsCore([], newFiles, BASE_PATH);
			expect(result[0].fileName).toBe('ordered.cfg');
			expect(result[1].fileName).toBe('no-order.cfg');
		});

		it('preserves newFiles order when no order property is set (position-based)', async () => {
			// Two unchanged files, no order, second before first in newFiles
			const oldFiles = [
				makeFile({ fileName: 'z.cfg', content: 'z', exists: true, diskContent: 'z' }),
				makeFile({ fileName: 'a.cfg', content: 'a', exists: true, diskContent: 'a' }),
			];
			const newFiles = [
				makeFile({ fileName: 'z.cfg', content: 'z', exists: true, diskContent: 'z' }),
				makeFile({ fileName: 'a.cfg', content: 'a', exists: true, diskContent: 'a' }),
			];
			const result = await compareSettingsCore(oldFiles, newFiles, BASE_PATH);
			expect(result[0].fileName).toBe('z.cfg'); // position 0 in newFiles
			expect(result[1].fileName).toBe('a.cfg'); // position 1 in newFiles
		});

		it('sorts alphabetically when order and newFiles position are equal (tie-breaker)', async () => {
			// Both files are removed – they have no entry in newFiles (findIndex = -1 for both)
			// so alphabetical is the final tie-breaker.
			const oldFiles = [
				makeFile({ fileName: 'z-removed.cfg', content: 'z', exists: true, diskContent: 'z' }),
				makeFile({ fileName: 'a-removed.cfg', content: 'a', exists: true, diskContent: 'a' }),
			];
			const result = await compareSettingsCore(oldFiles, [], BASE_PATH);
			expect(result[0].fileName).toBe('a-removed.cfg');
			expect(result[1].fileName).toBe('z-removed.cfg');
		});

		it('files absent from newFiles (removed) sort before files that appear in newFiles, due to findIndex=-1', async () => {
			// This is a consequence of the implementation: removed files return -1 from findIndex,
			// which is less than any valid index (0+), so they sort to the front.
			const oldFiles = [makeFile({ fileName: 'removed.cfg', content: 'r', exists: true, diskContent: 'r' })];
			const newFiles = [makeFile({ fileName: 'created.cfg', content: 'c', exists: false, diskContent: null })];
			const result = await compareSettingsCore(oldFiles, newFiles, BASE_PATH);
			expect(result[0].fileName).toBe('removed.cfg');
			expect(result[1].fileName).toBe('created.cfg');
		});

		it('order property takes precedence over newFiles position', async () => {
			// first.cfg is at index 0 in newFiles but has a higher order value
			const newFiles = [
				makeFile({ fileName: 'first-in-array.cfg', content: 'a', exists: false, diskContent: null, order: 5 }),
				makeFile({ fileName: 'second-in-array.cfg', content: 'b', exists: false, diskContent: null, order: 1 }),
			];
			const result = await compareSettingsCore([], newFiles, BASE_PATH);
			expect(result[0].fileName).toBe('second-in-array.cfg'); // lower order wins
			expect(result[1].fileName).toBe('first-in-array.cfg');
		});

		it('files with the same order value fall back to newFiles position', async () => {
			const newFiles = [
				makeFile({ fileName: 'b.cfg', content: 'b', exists: false, diskContent: null, order: 1 }),
				makeFile({ fileName: 'a.cfg', content: 'a', exists: false, diskContent: null, order: 1 }),
			];
			// Same order=1, so position in newFiles (b=0, a=1) determines the result
			const result = await compareSettingsCore([], newFiles, BASE_PATH);
			expect(result[0].fileName).toBe('b.cfg');
			expect(result[1].fileName).toBe('a.cfg');
		});
	});

	// =========================================================================
	//  EXEC / WRITEFILECALL COUNTS (integration with mocks)
	// =========================================================================
	describe('exec call counts', () => {
		it('calls exec once per created file', async () => {
			const newFiles = [
				makeFile({ fileName: 'a.cfg', content: 'a', exists: false, diskContent: null }),
				makeFile({ fileName: 'b.cfg', content: 'b', exists: false, diskContent: null }),
			];
			await compareSettingsCore([], newFiles, BASE_PATH);
			expect(mockExec).toHaveBeenCalledTimes(2);
		});

		it('calls exec once per removed file', async () => {
			const oldFiles = [
				makeFile({ fileName: 'a.cfg', content: 'a', exists: true, diskContent: 'a' }),
				makeFile({ fileName: 'b.cfg', content: 'b', exists: true, diskContent: 'b' }),
			];
			await compareSettingsCore(oldFiles, [], BASE_PATH);
			expect(mockExec).toHaveBeenCalledTimes(2);
		});

		it('does not call exec for a changed file when skipDiff applies', async () => {
			const newContent = 'new';
			const oldFile = makeFile({ fileName: 'f.cfg', content: 'old', exists: true, diskContent: newContent });
			const newFile = makeFile({ fileName: 'f.cfg', content: newContent, exists: true, diskContent: newContent });
			await compareSettingsCore([oldFile], [newFile], BASE_PATH);
			expect(mockExec).not.toHaveBeenCalled();
		});

		it('does not call exec for unchanged files with no changedOnDisk', async () => {
			const content = 'same';
			const oldFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content });
			const newFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content });
			await compareSettingsCore([oldFile], [newFile], BASE_PATH);
			expect(mockExec).not.toHaveBeenCalled();
		});

		it('calls exec for unchanged file that has changedOnDisk', async () => {
			const content = 'gen';
			const oldFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: 'edited' });
			const newFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: 'edited' });
			await compareSettingsCore([oldFile], [newFile], BASE_PATH);
			expect(mockExec).toHaveBeenCalledTimes(1);
		});
	});

	// =========================================================================
	//  WRITEFILECALL BEHAVIOUR
	// =========================================================================
	describe('writeFile call behaviour', () => {
		it('calls writeFile for each created file (to materialise content in /tmp)', async () => {
			const newFiles = [
				makeFile({ fileName: 'a.cfg', content: 'a', exists: false, diskContent: null }),
				makeFile({ fileName: 'b.cfg', content: 'b', exists: false, diskContent: null }),
			];
			await compareSettingsCore([], newFiles, BASE_PATH);
			expect(mockWriteFile).toHaveBeenCalledTimes(2);
		});

		it('calls writeFile for each removed file (to create diff input)', async () => {
			const oldFiles = [makeFile({ fileName: 'gone.cfg', content: 'x', exists: true, diskContent: 'x' })];
			await compareSettingsCore(oldFiles, [], BASE_PATH);
			// At least one writeFile call for the removed file's /tmp materialisation
			expect(mockWriteFile).toHaveBeenCalledTimes(1);
		});

		it('does not call writeFile for a changed file with skipDiff (old exists, new content matches disk)', async () => {
			const newContent = 'new';
			const oldFile = makeFile({ fileName: 'f.cfg', content: 'old', exists: true, diskContent: newContent });
			const newFile = makeFile({ fileName: 'f.cfg', content: newContent, exists: true, diskContent: newContent });
			await compareSettingsCore([oldFile], [newFile], BASE_PATH);
			expect(mockWriteFile).not.toHaveBeenCalled();
		});

		it('does not call writeFile for unchanged files with no changedOnDisk', async () => {
			const content = 'same';
			const oldFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content });
			const newFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: content });
			await compareSettingsCore([oldFile], [newFile], BASE_PATH);
			expect(mockWriteFile).not.toHaveBeenCalled();
		});

		it('calls writeFile for unchanged file with changedOnDisk (new content temp file)', async () => {
			const content = 'gen';
			const oldFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: 'edited' });
			const newFile = makeFile({ fileName: 'f.cfg', content, exists: true, diskContent: 'edited' });
			await compareSettingsCore([oldFile], [newFile], BASE_PATH);
			// At minimum the new-content temp file is written
			expect(mockWriteFile).toHaveBeenCalledTimes(1);
		});
	});
});
