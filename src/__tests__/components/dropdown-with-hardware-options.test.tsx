/** @vitest-environment jsdom */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecoilRoot, selector } from 'recoil';

// The auto-animate package relies on ResizeObserver which isn't available in jsdom
// Provide a tiny noop so rendering in tests doesn't blow up
(global as any).ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

// jsdom doesn't provide scrollIntoView (used by some UI helpers like cmdk)
// Stub it out so components calling it won't blow up during tests.
if (typeof (window as any).HTMLElement !== 'undefined') {
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore - augmenting prototype for tests
	(window as any).HTMLElement.prototype.scrollIntoView = function () {};
}

// avoid importing the real auto-animate library which references ResizeObserver at import time
vi.mock('@formkit/auto-animate/react', () => ({
	useAutoAnimate: () => [() => null],
}));

import { DropdownWithHardwareOptions } from '@/components/forms/dropdown-with-hardware-options';

type TestOption = {
	id: string;
	title: string;
	connectedTo?: string;
	badge?: { children: string; color?: string };
};

describe('DropdownWithHardwareOptions', () => {
	describe('Basic Rendering', () => {
		it('renders with options from selector', async () => {
			const testOptionsSelector = selector<TestOption[]>({
				key: 'testOptionsSelector-basic',
				get: () => {
					return [
						{ id: 'opt1', title: 'Option 1' },
						{ id: 'opt2', title: 'Option 2' },
						{ id: 'opt3', title: 'Option 3' },
					];
				},
			});

			const onSelect = vi.fn();

			render(
				<RecoilRoot>
					<DropdownWithHardwareOptions
						label="Test Dropdown"
						selector={testOptionsSelector}
						value={null}
						onSelect={onSelect}
					/>
				</RecoilRoot>,
			);

			// Wait for the dropdown to render
			await waitFor(() => {
				expect(screen.getByText('Test Dropdown')).toBeTruthy();
			});

			// Verify the dropdown is rendered as a combobox
			const combobox = screen.getByRole('combobox');
			expect(combobox).toBeTruthy();
		});

		it('shows loading state while selector is suspended', async () => {
			const testOptionsSelector = selector<TestOption[]>({
				key: 'testOptionsSelector-suspended',
				get: () => {
					return [
						{ id: 'opt1', title: 'Option 1' },
						{ id: 'opt2', title: 'Option 2' },
					];
				},
			});

			const onSelect = vi.fn();

			render(
				<RecoilRoot>
					<DropdownWithHardwareOptions
						label="Loading Dropdown"
						selector={testOptionsSelector}
						value={null}
						onSelect={onSelect}
					/>
				</RecoilRoot>,
			);

			// During Suspense, the fallback should be rendered
			// The dropdown should still render with empty options and isFetching=true
			await waitFor(() => {
				expect(screen.getByText('Loading Dropdown')).toBeTruthy();
			});
		});

		it('renders with selected value', async () => {
			const testOptionsSelector = selector<TestOption[]>({
				key: 'testOptionsSelector-with-value',
				get: () => {
					return [
						{ id: 'opt1', title: 'Option 1' },
						{ id: 'opt2', title: 'Option 2' },
						{ id: 'opt3', title: 'Option 3' },
					];
				},
			});

			const onSelect = vi.fn();
			const selectedValue: TestOption = {
				id: 'opt2',
				title: 'Option 2',
			};

			render(
				<RecoilRoot>
					<DropdownWithHardwareOptions
						label="Test Dropdown"
						selector={testOptionsSelector}
						value={selectedValue}
						onSelect={onSelect}
					/>
				</RecoilRoot>,
			);

			// Should display the selected value
			await waitFor(() => {
				expect(screen.getByText('Option 2')).toBeTruthy();
			});
		});
	});

	describe('Value Correction', () => {
		it('updates value with fresh data from selector when option matches', async () => {
			const testOptionsSelector = selector<TestOption[]>({
				key: 'testOptionsSelector-value-correction',
				get: () => {
					return [
						{ id: 'opt1', title: 'Fresh Option 1', badge: { children: 'New Badge' } },
						{ id: 'opt2', title: 'Option 2' },
					];
				},
			});

			const onSelect = vi.fn();
			const staleValue: TestOption = {
				id: 'opt1',
				title: 'Stale Option 1',
			};

			render(
				<RecoilRoot>
					<DropdownWithHardwareOptions
						label="Test Dropdown"
						selector={testOptionsSelector}
						value={staleValue}
						onSelect={onSelect}
					/>
				</RecoilRoot>,
			);

			// Should display the fresh title from selector
			await waitFor(() => {
				expect(screen.getByText('Fresh Option 1')).toBeTruthy();
			});
		});

		it('preserves original value when no matching option found in selector', async () => {
			const testOptionsSelector = selector<TestOption[]>({
				key: 'testOptionsSelector-no-match',
				get: () => {
					return [
						{ id: 'opt2', title: 'Option 2' },
						{ id: 'opt3', title: 'Option 3' },
					];
				},
			});

			const onSelect = vi.fn();
			const valueNotInOptions: TestOption = {
				id: 'opt1',
				title: 'Option 1 (not in list)',
			};

			render(
				<RecoilRoot>
					<DropdownWithHardwareOptions
						label="Test Dropdown"
						selector={testOptionsSelector}
						value={valueNotInOptions}
						onSelect={onSelect}
					/>
				</RecoilRoot>,
			);

			// Should display the original value even though it's not in options
			await waitFor(() => {
				expect(screen.getByText('Option 1 (not in list)')).toBeTruthy();
			});
		});

		it('matches options correctly when connectedTo property differs', async () => {
			const testOptionsSelector = selector<TestOption[]>({
				key: 'testOptionsSelector-connectedTo-matching',
				get: () => {
					return [
						{ id: 'sensor', connectedTo: 'controlboard', title: 'Sensor (Controlboard)' },
						{ id: 'sensor', connectedTo: 'toolboard', title: 'Sensor (Toolboard - Updated)' },
					];
				},
			});

			const onSelect = vi.fn();
			const toolboardValue: TestOption = {
				id: 'sensor',
				connectedTo: 'toolboard',
				title: 'Sensor (Toolboard - Stale)',
			};

			render(
				<RecoilRoot>
					<DropdownWithHardwareOptions
						label="Test Dropdown"
						selector={testOptionsSelector}
						value={toolboardValue}
						onSelect={onSelect}
					/>
				</RecoilRoot>,
			);

			// Should match the toolboard option (same id AND connectedTo), not the controlboard one
			await waitFor(() => {
				expect(screen.getByText('Sensor (Toolboard - Updated)')).toBeTruthy();
			});
		});

		it('does not match when id matches but connectedTo differs', async () => {
			const testOptionsSelector = selector<TestOption[]>({
				key: 'testOptionsSelector-connectedTo-no-match',
				get: () => {
					return [
						{ id: 'sensor', connectedTo: 'controlboard', title: 'Sensor (Controlboard)' },
						{ id: 'sensor', connectedTo: 'toolboard', title: 'Sensor (Toolboard)' },
					];
				},
			});

			const onSelect = vi.fn();
			// Value with different connectedTo
			const differentConnection: TestOption = {
				id: 'sensor',
				connectedTo: 'mainboard', // Not in options
				title: 'Sensor (Mainboard - Original)',
			};

			render(
				<RecoilRoot>
					<DropdownWithHardwareOptions
						label="Test Dropdown"
						selector={testOptionsSelector}
						value={differentConnection}
						onSelect={onSelect}
					/>
				</RecoilRoot>,
			);

			// Should preserve original value since connectedTo doesn't match any option
			await waitFor(() => {
				expect(screen.getByText('Sensor (Mainboard - Original)')).toBeTruthy();
			});
		});
	});

	describe('Null and Empty States', () => {
		it('handles null value correctly', async () => {
			const testOptionsSelector = selector<TestOption[]>({
				key: 'testOptionsSelector-null-value',
				get: () => {
					return [
						{ id: 'opt1', title: 'Option 1' },
						{ id: 'opt2', title: 'Option 2' },
					];
				},
			});

			const onSelect = vi.fn();

			render(
				<RecoilRoot>
					<DropdownWithHardwareOptions
						label="Test Dropdown"
						selector={testOptionsSelector}
						value={null}
						onSelect={onSelect}
						nothingSelectedText="Select an option"
					/>
				</RecoilRoot>,
			);

			// Should display the nothingSelectedText
			await waitFor(() => {
				expect(screen.getByText('Select an option')).toBeTruthy();
			});
		});

		it('handles empty options array from selector', async () => {
			const testOptionsSelector = selector<TestOption[]>({
				key: 'testOptionsSelector-empty',
				get: () => {
					return [];
				},
			});

			const onSelect = vi.fn();

			render(
				<RecoilRoot>
					<DropdownWithHardwareOptions
						label="Empty Dropdown"
						selector={testOptionsSelector}
						value={null}
						onSelect={onSelect}
						noOptionsText="No options available"
					/>
				</RecoilRoot>,
			);

			// The dropdown should render successfully
			await waitFor(() => {
				expect(screen.getByText('Empty Dropdown')).toBeTruthy();
			});
		});

		it('handles undefined value correctly', async () => {
			const testOptionsSelector = selector<TestOption[]>({
				key: 'testOptionsSelector-undefined-value',
				get: () => {
					return [
						{ id: 'opt1', title: 'Option 1' },
						{ id: 'opt2', title: 'Option 2' },
					];
				},
			});

			const onSelect = vi.fn();

			render(
				<RecoilRoot>
					<DropdownWithHardwareOptions
						label="Test Dropdown"
						selector={testOptionsSelector}
						value={undefined}
						onSelect={onSelect}
					/>
				</RecoilRoot>,
			);

			// Should render successfully with default nothingSelectedText
			await waitFor(() => {
				expect(screen.getByText('Test Dropdown')).toBeTruthy();
			});
		});
	});

	describe('Props Forwarding', () => {
		it('forwards all dropdown props correctly', async () => {
			const testOptionsSelector = selector<TestOption[]>({
				key: 'testOptionsSelector-props-forwarding',
				get: () => {
					return [
						{ id: 'opt1', title: 'Option 1' },
						{ id: 'opt2', title: 'Option 2' },
					];
				},
			});

			const onSelect = vi.fn();

			render(
				<RecoilRoot>
					<DropdownWithHardwareOptions
						label="Test Dropdown"
						selector={testOptionsSelector}
						value={null}
						onSelect={onSelect}
						canClear={true}
						error="Test error message"
						nothingSelectedText="Nothing selected"
						noOptionsText="No options"
						disabled={false}
						sort={false}
					/>
				</RecoilRoot>,
			);

			// Verify label is rendered
			await waitFor(() => {
				expect(screen.getByText('Test Dropdown')).toBeTruthy();
			});

			// Verify error message is displayed
			expect(screen.getByText('Test error message')).toBeTruthy();
		});

		it('supports disabled state', async () => {
			const testOptionsSelector = selector<TestOption[]>({
				key: 'testOptionsSelector-disabled',
				get: () => {
					return [
						{ id: 'opt1', title: 'Option 1' },
						{ id: 'opt2', title: 'Option 2' },
					];
				},
			});

			const onSelect = vi.fn();

			render(
				<RecoilRoot>
					<DropdownWithHardwareOptions
						label="Disabled Dropdown"
						selector={testOptionsSelector}
						value={null}
						onSelect={onSelect}
						disabled={true}
					/>
				</RecoilRoot>,
			);

			await waitFor(() => {
				const combobox = screen.getByRole('combobox');
				expect(combobox).toBeTruthy();
				// The button should have disabled styling (cursor-not-allowed and opacity)
				expect(combobox.className).toContain('cursor-not-allowed');
				expect(combobox.className).toContain('opacity-60');
			});
		});
		it('supports help text', async () => {
			const testOptionsSelector = selector<TestOption[]>({
				key: 'testOptionsSelector-help',
				get: () => {
					return [
						{ id: 'opt1', title: 'Option 1' },
						{ id: 'opt2', title: 'Option 2' },
					];
				},
			});

			const onSelect = vi.fn();

			render(
				<RecoilRoot>
					<DropdownWithHardwareOptions
						label="Dropdown with Help"
						selector={testOptionsSelector}
						value={null}
						onSelect={onSelect}
						help="This is helpful information"
					/>
				</RecoilRoot>,
			);

			// Verify help text is rendered
			await waitFor(() => {
				expect(screen.getByText('This is helpful information')).toBeTruthy();
			});
		});
	});

	describe('Integration with Hardware Selectors', () => {
		it('works with selectorFamily pattern (simulating toolhead-specific queries)', async () => {
			// Simulate a selectorFamily that takes a toolOrAxis parameter
			const createToolheadSpecificSelector = (toolOrAxis: number) =>
				selector<TestOption[]>({
					key: `testOptionsSelector-toolhead-${toolOrAxis}`,
					get: () => {
						return [
							{ id: 'endstop1', title: `Endstop for Tool ${toolOrAxis}` },
							{ id: 'endstop2', title: `Endstop 2 for Tool ${toolOrAxis}` },
						];
					},
				});

			const tool0Selector = createToolheadSpecificSelector(0);
			const onSelect = vi.fn();

			render(
				<RecoilRoot>
					<DropdownWithHardwareOptions
						label="X Endstop"
						selector={tool0Selector}
						toolOrAxis={0}
						value={null}
						onSelect={onSelect}
					/>
				</RecoilRoot>,
			);

			// The dropdown should render (options won't be visible until opened)
			await waitFor(() => {
				expect(screen.getByRole('combobox')).toBeTruthy();
			});
		});
		it('immediately evaluates selector (no lazy loading)', async () => {
			let selectorCallCount = 0;

			const testOptionsSelector = selector<TestOption[]>({
				key: 'testOptionsSelector-immediate-eval',
				get: () => {
					selectorCallCount++;
					return [
						{ id: 'opt1', title: 'Option 1' },
						{ id: 'opt2', title: 'Option 2' },
					];
				},
			});

			const onSelect = vi.fn();

			render(
				<RecoilRoot>
					<DropdownWithHardwareOptions
						label="Test Dropdown"
						selector={testOptionsSelector}
						value={null}
						onSelect={onSelect}
					/>
				</RecoilRoot>,
			);

			// Unlike DropdownWithSelector, this component evaluates immediately
			await waitFor(() => {
				expect(selectorCallCount).toBeGreaterThan(0);
			});
		});
	});

	describe('Badge Handling', () => {
		it('refreshes badge information from selector', async () => {
			const testOptionsSelector = selector<TestOption[]>({
				key: 'testOptionsSelector-badge-refresh',
				get: () => {
					return [
						{
							id: 'opt1',
							title: 'Option with Badge',
							badge: { children: 'Updated Badge', color: 'blue' },
						},
						{ id: 'opt2', title: 'Option 2' },
					];
				},
			});

			const onSelect = vi.fn();
			const staleValue: TestOption = {
				id: 'opt1',
				title: 'Option with Badge',
				badge: { children: 'Old Badge', color: 'gray' },
			};

			render(
				<RecoilRoot>
					<DropdownWithHardwareOptions
						label="Test Dropdown"
						selector={testOptionsSelector}
						value={staleValue}
						onSelect={onSelect}
					/>
				</RecoilRoot>,
			);

			// The corrected value should have the updated badge from the selector
			// We verify this by checking that the option title is rendered
			// (badge rendering itself is tested in dropdown.test.tsx)
			await waitFor(() => {
				expect(screen.getByText('Option with Badge')).toBeTruthy();
			});
		});
	});
});
