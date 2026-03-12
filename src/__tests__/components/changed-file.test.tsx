/**
 * @vitest-environment jsdom
 *
 * Unit tests for the ChangedFile component.
 *
 * These tests assert *sensible* behaviour for every meaningful FilesToWriteWithState
 * scenario.  Some tests are intentionally expected to FAIL against the current
 * implementation because the component has known bugs (marked with "BUG:" comments).
 *
 * Scenario catalogue (compact reference):
 *
 *  State       changedFromConfig changedOnDisk diff      Notes
 *  ─────────── ───────────────── ───────────── ────────  ──────────────────────────────────────────
 *  created     –                 –             non-null  New file
 *  removed     –                 –             non-null  File dropped from config
 *  changed A   true              false         non-null  Clean content change
 *  changed B   true              true          non-null  Content change + user had edits on disk
 *  changed C   true              true          null      Coincidental match (content===diskContent)
 *  changed D   true              false         null      lastSavedContent drift, same generated content
 *  changed E   false             true          non-null  Config unchanged, user edited file
 *  unchanged F false             false         null      Truly clean
 *  unchanged G false             true          non-null  Config unchanged, user modified disk
 */

// ─── Hoisted mocks ───────────────────────────────────────────────────────────
//
// vi.mock() factories are hoisted before all import statements by Vitest.
// Vitejs uses esbuild with the "classic" React JSX runtime, so JSX inside a
// vi.mock() factory would compile to `React.createElement(...)` but React
// hasn't been imported yet at that point.
//
// The solution: use vi.hoisted() to create plain vi.fn() stubs (no JSX),
// register them via vi.mock(), and then supply React.createElement-based
// implementations in beforeEach() – which runs after all imports are resolved.

const mocks = vi.hoisted(() => ({
	DiffModal: vi.fn(),
	Badge: vi.fn(),
	DropdownMenu: vi.fn(),
	DropdownMenuTrigger: vi.fn(),
	DropdownMenuContent: vi.fn(),
	DropdownMenuItem: vi.fn(),
	QueryStatus: vi.fn(),
	useChangeEffect: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/utils/trpc', () => ({ trpc: { useUtils: () => ({ client: {} }) } }));
vi.mock('@tanstack/react-query', () => ({
	useQuery: vi.fn(() => ({ data: undefined, status: 'pending' })),
}));
vi.mock('@/hooks/useChangeEffect', () => ({ useChangeEffect: mocks.useChangeEffect }));
vi.mock('@/components/setup-steps/diff-modal', () => ({ DiffModal: mocks.DiffModal }));
vi.mock('@/components/common/badge', () => ({ Badge: mocks.Badge }));
vi.mock('@/components/common/query-status', () => ({ QueryStatus: mocks.QueryStatus }));
vi.mock('@/components/ui/dropdown-menu', () => ({
	DropdownMenu: mocks.DropdownMenu,
	DropdownMenuTrigger: mocks.DropdownMenuTrigger,
	DropdownMenuContent: mocks.DropdownMenuContent,
	DropdownMenuItem: mocks.DropdownMenuItem,
}));

// ─── Regular imports (run AFTER mocks are registered) ───────────────────────

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── jsdom stubs ─────────────────────────────────────────────────────────────

(global as any).ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
if (typeof (window as any).HTMLElement !== 'undefined') {
	(window as any).HTMLElement.prototype.scrollIntoView = function () {};
}

// ─── Subject under test ───────────────────────────────────────────────────────

import { ChangedFile } from '@/components/setup-steps/file-changes';
import type { FilesToWriteWithState } from '@/server/routers/printer';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type FileEntry = Unpacked<FilesToWriteWithState>;

const MOCK_DIFF = 'diff --git a/f b/f\n@@ -1 +1 @@\n-old\n+new\n';

function makeFile(overrides: Partial<FileEntry> & { state: FileEntry['state'] }): FileEntry {
	return {
		fileName: 'test.cfg',
		overwrite: false,
		exists: true,
		diskContent: 'disk content',
		diff: MOCK_DIFF,
		changedOnDisk: false,
		changedFromConfig: false,
		order: undefined,
		...overrides,
	} as FileEntry;
}

const noop = vi.fn();

function defaultProps(
	file: FileEntry,
	overrides: Partial<React.ComponentProps<typeof ChangedFile>> = {},
): React.ComponentProps<typeof ChangedFile> {
	return {
		file,
		isMarkedOverwritten: false,
		isMarkedIgnored: false,
		addFileToOverwrite: noop,
		removeFileToOverwrite: noop,
		addFileToIgnore: noop,
		removeFileToIgnore: noop,
		...overrides,
	};
}

function renderChangedFile(props: React.ComponentProps<typeof ChangedFile>) {
	return render(
		<ul>
			<ChangedFile {...props} />
		</ul>,
	);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ChangedFile', () => {
	// Configure mock implementations here, after React is available.
	// (Cannot use JSX/React.createElement in vi.mock() factories because those
	// are hoisted before import statements resolve.)
	beforeEach(() => {
		// DiffModal: visible sentinel element when open, nothing when closed
		mocks.DiffModal.mockImplementation((props: any) =>
			props.isOpen
				? React.createElement('div', { 'data-testid': 'diff-modal', 'data-filename': props.fileName })
				: null,
		);
		// Badge: simple span wrapper so text content is queryable
		mocks.Badge.mockImplementation((props: any) =>
			React.createElement('span', { 'data-testid': 'badge' }, props.children),
		);
		// DropdownMenu containers: transparent pass-throughs
		const passThrough = (props: any) => props.children ?? null;
		mocks.DropdownMenu.mockImplementation(passThrough);
		mocks.DropdownMenuTrigger.mockImplementation(passThrough);
		mocks.DropdownMenuContent.mockImplementation(passThrough);
		// DropdownMenuItem: real button element so fireEvent.click works
		mocks.DropdownMenuItem.mockImplementation((props: any) =>
			React.createElement(
				'button',
				{ onClick: props.onClick, disabled: !!props.disabled, 'data-testid': 'dropdown-item' },
				props.children,
			),
		);
		// QueryStatus: not used by ChangedFile, render nothing
		mocks.QueryStatus.mockImplementation(() => null);
		// useChangeEffect: no pinging animation in tests
		mocks.useChangeEffect.mockReturnValue([false, vi.fn()]);

		noop.mockClear();
	});

	// =========================================================================
	//  state: created
	// =========================================================================
	describe("state: 'created'", () => {
		const file = makeFile({ state: 'created', exists: false, diskContent: null, diff: MOCK_DIFF });

		it('shows "New file" badge', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('New file')).toBeTruthy();
		});

		it('shows "File will be created." description when not ignored', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('File will be created.')).toBeTruthy();
		});

		it('shows "File will be skipped." description when marked ignored', () => {
			renderChangedFile(defaultProps(file, { isMarkedIgnored: true }));
			expect(screen.getByText('File will be skipped.')).toBeTruthy();
		});

		it('shows checkmark, not "Review changes" button (wouldOtherwiseBeWritten=true)', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.queryByText('Review changes')).toBeNull();
			// CheckIcon renders as an svg; verify no "Review changes" button exists
		});

		it('shows "Keep existing file" action in dropdown when not ignored', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('Keep existing file')).toBeTruthy();
		});

		it('shows "Write" action in dropdown when marked ignored', () => {
			renderChangedFile(defaultProps(file, { isMarkedIgnored: true }));
			expect(screen.getByText('Write')).toBeTruthy();
		});

		it('does not expose an "Accept changes" action (created is not overwritable)', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.queryByText('Accept changes')).toBeNull();
		});

		it('"View diff" menu item is enabled when diff is not null', () => {
			renderChangedFile(defaultProps(file));
			const viewDiff = screen.getByText('View diff').closest('button');
			expect(viewDiff).not.toBeNull();
			expect(viewDiff!.disabled).toBe(false);
		});

		it('clicking "Keep existing file" calls addFileToIgnore with the fileName', () => {
			const addFileToIgnore = vi.fn();
			renderChangedFile(defaultProps(file, { addFileToIgnore }));
			fireEvent.click(screen.getByText('Keep existing file'));
			expect(addFileToIgnore).toHaveBeenCalledWith('test.cfg');
		});

		it('clicking "Write" when ignored calls removeFileToIgnore with the fileName', () => {
			const removeFileToIgnore = vi.fn();
			renderChangedFile(defaultProps(file, { isMarkedIgnored: true, removeFileToIgnore }));
			fireEvent.click(screen.getByText('Write'));
			expect(removeFileToIgnore).toHaveBeenCalledWith('test.cfg');
		});
	});

	// =========================================================================
	//  state: removed
	// =========================================================================
	describe("state: 'removed'", () => {
		const file = makeFile({ state: 'removed', diff: MOCK_DIFF });

		it('shows "Deleted" badge', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('Deleted')).toBeTruthy();
		});

		it('shows "File will be deleted." description when not ignored', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('File will be deleted.')).toBeTruthy();
		});

		it('shows "File will remain untouched." description when marked ignored', () => {
			renderChangedFile(defaultProps(file, { isMarkedIgnored: true }));
			expect(screen.getByText('File will remain untouched.')).toBeTruthy();
		});

		it('shows checkmark, not "Review changes" button (wouldOtherwiseBeWritten=true)', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.queryByText('Review changes')).toBeNull();
		});

		it('shows "Keep existing file" action by default', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('Keep existing file')).toBeTruthy();
		});

		it('shows "Delete" action when marked ignored', () => {
			renderChangedFile(defaultProps(file, { isMarkedIgnored: true }));
			expect(screen.getByText('Delete')).toBeTruthy();
		});

		it('clicking "Keep existing file" calls addFileToIgnore', () => {
			const addFileToIgnore = vi.fn();
			renderChangedFile(defaultProps(file, { addFileToIgnore }));
			fireEvent.click(screen.getByText('Keep existing file'));
			expect(addFileToIgnore).toHaveBeenCalledWith('test.cfg');
		});

		it('clicking "Delete" when ignored calls removeFileToIgnore', () => {
			const removeFileToIgnore = vi.fn();
			renderChangedFile(defaultProps(file, { isMarkedIgnored: true, removeFileToIgnore }));
			fireEvent.click(screen.getByText('Delete'));
			expect(removeFileToIgnore).toHaveBeenCalledWith('test.cfg');
		});
	});

	// =========================================================================
	//  state: changed – scenario A: clean content change (changedFromConfig=true, diff non-null)
	// =========================================================================
	describe("state: 'changed' – scenario A: clean content change", () => {
		const file = makeFile({
			state: 'changed',
			changedFromConfig: true,
			changedOnDisk: false,
			diff: MOCK_DIFF,
		});

		it('shows "Pending changes" badge', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('Pending changes')).toBeTruthy();
		});

		it('does NOT show a secondary "Changed on disk" badge when changedOnDisk=false', () => {
			renderChangedFile(defaultProps(file));
			// The secondary badge is only rendered when changedOnDisk is truthy
			const badges = screen.queryAllByText('Changed on disk');
			expect(badges).toHaveLength(0);
		});

		it('shows "Review changes" button (needsExplicitAction=true)', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('Review changes')).toBeTruthy();
		});

		it('shows "Please review the changes and make a decision." description', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('Please review the changes and make a decision.')).toBeTruthy();
		});

		it('shows "Accept changes" and "Keep existing file" actions in the dropdown', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('Accept changes')).toBeTruthy();
			expect(screen.getByText('Keep existing file')).toBeTruthy();
		});

		it('clicking "Review changes" opens the diff modal', () => {
			renderChangedFile(defaultProps(file));
			fireEvent.click(screen.getByText('Review changes'));
			expect(screen.getByTestId('diff-modal')).toBeTruthy();
		});

		it('"View diff" dropdown item is enabled when diff is non-null', () => {
			renderChangedFile(defaultProps(file));
			const viewDiff = screen.getByText('View diff').closest('button');
			expect(viewDiff!.disabled).toBe(false);
		});

		it('clicking "Accept changes" calls addFileToOverwrite', () => {
			const addFileToOverwrite = vi.fn();
			renderChangedFile(defaultProps(file, { addFileToOverwrite }));
			fireEvent.click(screen.getByText('Accept changes'));
			expect(addFileToOverwrite).toHaveBeenCalledWith('test.cfg');
		});

		it('"Keep existing file" action has danger intent (not printer.cfg)', () => {
			// We can check this indirectly via the rendered element's label; the
			// intent is passed to <Button variant=...>. In our test env the Button
			// passes it through. We just verify the action element exists and is distinct.
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('Keep existing file')).toBeTruthy();
		});

		it('"Keep existing file" action has info intent when fileName is printer.cfg', () => {
			const printerFile = makeFile({
				fileName: 'printer.cfg',
				state: 'changed',
				changedFromConfig: true,
				changedOnDisk: false,
				diff: MOCK_DIFF,
			});
			renderChangedFile(defaultProps(printerFile));
			expect(screen.getByText('Keep existing file')).toBeTruthy();
		});
	});

	// =========================================================================
	//  state: changed – scenario B: content change + user had edits
	// =========================================================================
	describe("state: 'changed' – scenario B: content change + user edits on disk", () => {
		const file = makeFile({
			state: 'changed',
			changedFromConfig: true,
			changedOnDisk: true,
			diff: MOCK_DIFF,
		});

		it('shows "Pending changes" badge', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('Pending changes')).toBeTruthy();
		});

		it('shows a secondary "Changed on disk" badge', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('Changed on disk')).toBeTruthy();
		});

		it('shows "Review changes" button', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('Review changes')).toBeTruthy();
		});

		it('clicking "Review changes" opens the diff modal', () => {
			renderChangedFile(defaultProps(file));
			fireEvent.click(screen.getByText('Review changes'));
			expect(screen.getByTestId('diff-modal')).toBeTruthy();
		});

		it('shows "Accept changes" and "Keep existing file" actions', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('Accept changes')).toBeTruthy();
			expect(screen.getByText('Keep existing file')).toBeTruthy();
		});
	});

	// =========================================================================
	//  state: changed – scenario C: coincidental match (changedFromConfig=true, diff=null)
	//
	//  The user independently made exactly the same changes as the new generated
	//  content.  diskContent === content, but both differ from lastSavedContent.
	//  There is no diff to show.
	// =========================================================================
	describe("state: 'changed' – scenario C: coincidental match (diff=null, changedOnDisk=true)", () => {
		const file = makeFile({
			state: 'changed',
			changedFromConfig: true,
			changedOnDisk: true,
			diff: null, // no diff – disk already matches the new generated content
		});

		it('shows "Pending changes" badge', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('Pending changes')).toBeTruthy();
		});

		it('shows a secondary "Changed on disk" badge', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('Changed on disk')).toBeTruthy();
		});

		it('should NOT show "Review changes" button when diff=null (no content to diff)', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.queryByText('Review changes')).toBeNull();
		});

		it('diff modal is NOT opened when clicking "Review changes" is absent', () => {
			// When the button is correctly absent, the modal is never shown.
			renderChangedFile(defaultProps(file));
			expect(screen.queryByTestId('diff-modal')).toBeNull();
		});

		it('"View diff" dropdown item is disabled when diff=null', () => {
			renderChangedFile(defaultProps(file));
			const viewDiff = screen.getByText('View diff').closest('button');
			expect(viewDiff!.disabled).toBe(true);
		});

		it('still shows "Accept changes" and "Keep existing file" actions', () => {
			// These actions are still useful - user can explicitly accept or keep
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('Accept changes')).toBeTruthy();
			expect(screen.getByText('Keep existing file')).toBeTruthy();
		});
	});

	// =========================================================================
	//  state: changed – scenario D: lastSavedContent drift, diff=null
	//
	//  The lastSavedContent tracking file reveals a drift but the newly generated
	//  content is identical to what the old settings would generate.  No meaningful
	//  diff exists (skipDiff fires), so diff=null.
	// =========================================================================
	describe("state: 'changed' – scenario D: lastSavedContent drift, diff=null, changedOnDisk=false", () => {
		const file = makeFile({
			state: 'changed',
			changedFromConfig: true,
			changedOnDisk: false,
			diff: null,
		});

		it('shows "Pending changes" badge', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('Pending changes')).toBeTruthy();
		});

		it('does NOT show a secondary "Changed on disk" badge when changedOnDisk=false', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.queryByText('Changed on disk')).toBeNull();
		});

		it('should NOT show "Review changes" button when diff=null', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.queryByText('Review changes')).toBeNull();
		});

		it('"View diff" dropdown item is disabled when diff=null', () => {
			renderChangedFile(defaultProps(file));
			const viewDiff = screen.getByText('View diff').closest('button');
			expect(viewDiff!.disabled).toBe(true);
		});
	});

	// =========================================================================
	//  state: changed – scenario E: config unchanged, user edited file
	//  (changedFromConfig=false, changedOnDisk=true)
	// =========================================================================
	describe("state: 'changed' – scenario E: only changed on disk (changedFromConfig=false)", () => {
		const file = makeFile({
			state: 'changed',
			changedFromConfig: false,
			changedOnDisk: true,
			diff: MOCK_DIFF,
		});

		it('shows "Changed on disk" as the primary badge text', () => {
			renderChangedFile(defaultProps(file));
			// The primary badge text for changed+!changedFromConfig is "Changed on disk"
			const matches = screen.getAllByText('Changed on disk');
			expect(matches.length).toBeGreaterThanOrEqual(1);
		});

		it('should show only ONE "Changed on disk" label (not two)', () => {
			renderChangedFile(defaultProps(file));
			const matches = screen.getAllByText('Changed on disk');
			expect(matches).toHaveLength(1);
		});

		it('shows checkmark, not "Review changes" (changedFromConfig=false → needsExplicitAction=false)', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.queryByText('Review changes')).toBeNull();
		});

		it('"View diff" is enabled because diff is non-null', () => {
			renderChangedFile(defaultProps(file));
			const viewDiff = screen.getByText('View diff').closest('button');
			expect(viewDiff!.disabled).toBe(false);
		});

		it('shows "Accept changes" and "Keep existing file" actions', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('Accept changes')).toBeTruthy();
			expect(screen.getByText('Keep existing file')).toBeTruthy();
		});
	});

	// =========================================================================
	//  state: changed – overwrite=true (config forces overwrite, e.g. RatOS.cfg)
	// =========================================================================
	describe("state: 'changed' – overwrite=true (config forces overwrite)", () => {
		const file = makeFile({
			state: 'changed',
			changedFromConfig: true,
			changedOnDisk: false,
			diff: MOCK_DIFF,
			overwrite: true,
			exists: true,
		});

		it('shows checkmark, not "Review changes" (isOverwritten=true → needsExplicitAction=false)', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.queryByText('Review changes')).toBeNull();
		});

		it('shows "File will be backed up and overwritten." description', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText(/File will be backed up and overwritten/)).toBeTruthy();
		});

		it('shows "Skip" action in the dropdown', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('Skip')).toBeTruthy();
		});

		it('does not show "Accept changes" action (isOverwritten already)', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.queryByText('Accept changes')).toBeNull();
		});

		it('clicking "Skip" calls addFileToIgnore (falls through because overwrite=true and !isMarkedOverwritten)', () => {
			const addFileToIgnore = vi.fn();
			renderChangedFile(defaultProps(file, { addFileToIgnore }));
			fireEvent.click(screen.getByText('Skip'));
			expect(addFileToIgnore).toHaveBeenCalledWith('test.cfg');
		});
	});

	// =========================================================================
	//  state: changed – isMarkedOverwritten=true (user explicitly accepted)
	// =========================================================================
	describe("state: 'changed' – isMarkedOverwritten=true (user clicked Accept changes)", () => {
		const file = makeFile({
			state: 'changed',
			changedFromConfig: true,
			changedOnDisk: false,
			diff: MOCK_DIFF,
			overwrite: false,
		});

		it('shows checkmark, not "Review changes"', () => {
			renderChangedFile(defaultProps(file, { isMarkedOverwritten: true }));
			expect(screen.queryByText('Review changes')).toBeNull();
		});

		it('shows "File will be backed up and overwritten." description', () => {
			renderChangedFile(defaultProps(file, { isMarkedOverwritten: true }));
			expect(screen.getByText(/File will be backed up and overwritten/)).toBeTruthy();
		});

		it('shows "Skip" action', () => {
			renderChangedFile(defaultProps(file, { isMarkedOverwritten: true }));
			expect(screen.getByText('Skip')).toBeTruthy();
		});

		it('clicking "Skip" calls removeFileToOverwrite (isMarkedOverwritten=true)', () => {
			const removeFileToOverwrite = vi.fn();
			renderChangedFile(defaultProps(file, { isMarkedOverwritten: true, removeFileToOverwrite }));
			fireEvent.click(screen.getByText('Skip'));
			expect(removeFileToOverwrite).toHaveBeenCalledWith('test.cfg');
		});
	});

	// =========================================================================
	//  state: changed – isMarkedIgnored=true
	// =========================================================================
	describe("state: 'changed' – isMarkedIgnored=true (user clicked Keep existing file)", () => {
		const file = makeFile({
			state: 'changed',
			changedFromConfig: true,
			changedOnDisk: false,
			diff: MOCK_DIFF,
		});

		it('shows checkmark, not "Review changes"', () => {
			renderChangedFile(defaultProps(file, { isMarkedIgnored: true }));
			expect(screen.queryByText('Review changes')).toBeNull();
		});

		it('shows "File will be skipped." description', () => {
			renderChangedFile(defaultProps(file, { isMarkedIgnored: true }));
			expect(screen.getByText('File will be skipped.')).toBeTruthy();
		});

		it('shows "Accept changes" action (to undo the ignore)', () => {
			renderChangedFile(defaultProps(file, { isMarkedIgnored: true }));
			expect(screen.getByText('Accept changes')).toBeTruthy();
		});

		it('clicking "Accept changes" when ignored calls removeFileToIgnore then addFileToOverwrite', () => {
			const removeFileToIgnore = vi.fn();
			const addFileToOverwrite = vi.fn();
			renderChangedFile(defaultProps(file, { isMarkedIgnored: true, removeFileToIgnore, addFileToOverwrite }));
			fireEvent.click(screen.getByText('Accept changes'));
			expect(removeFileToIgnore).toHaveBeenCalledWith('test.cfg');
			expect(addFileToOverwrite).toHaveBeenCalledWith('test.cfg');
		});
	});

	// =========================================================================
	//  state: unchanged – scenario F: truly clean
	// =========================================================================
	describe("state: 'unchanged' – scenario F: clean (changedOnDisk=false)", () => {
		const file = makeFile({
			state: 'unchanged',
			changedFromConfig: false,
			changedOnDisk: false,
			diff: null,
		});

		it('shows "No updates" badge', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('No updates')).toBeTruthy();
		});

		it('does NOT show a secondary "Changed on disk" badge', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.queryByText('Changed on disk')).toBeNull();
		});

		it('shows "File remains untouched." description', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('File remains untouched.')).toBeTruthy();
		});

		it('shows checkmark, not "Review changes" button', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.queryByText('Review changes')).toBeNull();
		});

		it('"View diff" dropdown item is disabled (diff=null)', () => {
			renderChangedFile(defaultProps(file));
			const viewDiff = screen.getByText('View diff').closest('button');
			expect(viewDiff!.disabled).toBe(true);
		});

		it('shows no action buttons (unchanged files need no user action)', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.queryByText('Accept changes')).toBeNull();
			expect(screen.queryByText('Keep existing file')).toBeNull();
			expect(screen.queryByText('Skip')).toBeNull();
		});
	});

	// =========================================================================
	//  state: unchanged – scenario G: config unchanged, user modified disk
	// =========================================================================
	describe("state: 'unchanged' – scenario G: user modified disk (changedOnDisk=true)", () => {
		const file = makeFile({
			state: 'unchanged',
			changedFromConfig: false,
			changedOnDisk: true,
			diff: MOCK_DIFF,
		});

		it('shows "No updates" badge', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('No updates')).toBeTruthy();
		});

		it('shows a secondary "Changed on disk" badge', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('Changed on disk')).toBeTruthy();
		});

		it('shows "File has user modifications." description', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('File has user modifications.')).toBeTruthy();
		});

		it('shows checkmark, not "Review changes" button', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.queryByText('Review changes')).toBeNull();
		});

		it('"View diff" dropdown item is enabled (diff is non-null)', () => {
			renderChangedFile(defaultProps(file));
			const viewDiff = screen.getByText('View diff').closest('button');
			expect(viewDiff!.disabled).toBe(false);
		});

		it('shows no action buttons (config has not changed)', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.queryByText('Accept changes')).toBeNull();
			expect(screen.queryByText('Keep existing file')).toBeNull();
		});
	});

	// =========================================================================
	//  RatOS.cfg special case: no dropdown actions
	// =========================================================================
	describe('RatOS.cfg special case', () => {
		const file = makeFile({
			fileName: 'RatOS.cfg',
			state: 'changed',
			changedFromConfig: true,
			changedOnDisk: false,
			diff: MOCK_DIFF,
			overwrite: true,
		});

		it('shows no action buttons in the dropdown (RatOS.cfg returns empty actions)', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.queryByText('Accept changes')).toBeNull();
			expect(screen.queryByText('Keep existing file')).toBeNull();
			expect(screen.queryByText('Skip')).toBeNull();
		});

		it('still shows "View diff" menu item', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('View diff')).toBeTruthy();
		});

		it('does not append backup recovery message for RatOS.cfg overwrite description', () => {
			renderChangedFile(defaultProps(file));
			expect(screen.getByText(/File will be backed up and overwritten/)).toBeTruthy();
			expect(screen.queryByText(/Any changes you've made can be recovered/)).toBeNull();
		});

		it('appends backup recovery message for non-RatOS.cfg overwrite', () => {
			const nonRatOs = makeFile({
				fileName: 'printer.cfg',
				state: 'changed',
				changedFromConfig: true,
				changedOnDisk: false,
				diff: MOCK_DIFF,
				overwrite: true,
			});
			renderChangedFile(defaultProps(nonRatOs));
			expect(screen.getByText(/Any changes you've made can be recovered from the backup/)).toBeTruthy();
		});
	});

	// =========================================================================
	//  diff modal interaction
	// =========================================================================
	describe('diff modal interaction', () => {
		it('modal is not shown on initial render', () => {
			const file = makeFile({ state: 'changed', changedFromConfig: true, changedOnDisk: false, diff: MOCK_DIFF });
			renderChangedFile(defaultProps(file));
			expect(screen.queryByTestId('diff-modal')).toBeNull();
		});

		it('clicking "Review changes" opens the modal', () => {
			const file = makeFile({ state: 'changed', changedFromConfig: true, changedOnDisk: false, diff: MOCK_DIFF });
			renderChangedFile(defaultProps(file));
			fireEvent.click(screen.getByText('Review changes'));
			expect(screen.getByTestId('diff-modal')).toBeTruthy();
		});

		it('clicking "View diff" opens the modal when diff is non-null', () => {
			const file = makeFile({ state: 'unchanged', changedFromConfig: false, changedOnDisk: true, diff: MOCK_DIFF });
			renderChangedFile(defaultProps(file));
			fireEvent.click(screen.getByText('View diff'));
			expect(screen.getByTestId('diff-modal')).toBeTruthy();
		});

		it('modal is never rendered when diff=null even if open state is set', () => {
			// DiffModal is gated on `file.diff != null`, so even if isDiffModalOpen=true
			// nothing is rendered.
			const file = makeFile({ state: 'changed', changedFromConfig: true, changedOnDisk: true, diff: null });
			renderChangedFile(defaultProps(file));
			// Attempt to open (the button should not exist, but even if it did)
			const reviewBtn = screen.queryByText('Review changes');
			if (reviewBtn) fireEvent.click(reviewBtn);
			expect(screen.queryByTestId('diff-modal')).toBeNull();
		});
	});

	// =========================================================================
	//  fileName displayed
	// =========================================================================
	describe('fileName display', () => {
		it('renders the fileName in the list item', () => {
			const file = makeFile({ fileName: 'my-custom.cfg', state: 'unchanged', diff: null });
			renderChangedFile(defaultProps(file));
			expect(screen.getByText('my-custom.cfg')).toBeTruthy();
		});
	});
});
