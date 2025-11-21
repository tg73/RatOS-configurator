/** @vitest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

import { Dropdown } from '@/components/forms/dropdown';

describe('Dropdown connectedTo-aware behavior', () => {
	it('treats options with same id but different connectedTo as distinct', () => {
		const options = [
			{ id: 'sensor-a', connectedTo: 'controlboard', title: 'Sensor (control)' },
			{ id: 'sensor-a', connectedTo: 'toolboard', title: 'Sensor (toolboard)' },
		];

		const onSelect = vi.fn();

		// Start with the controlboard option selected
		render(<Dropdown label="Sensor" options={options} value={options[0]} onSelect={onSelect} />);

		// Open the popover / dropdown
		const combobox = screen.getByRole('combobox');
		fireEvent.click(combobox);

		// The selected option (controlboard) should show the check icon (opacity-100)
		// getByText finds multiple elements (selected option + combobox label), so use getAllByText
		const matching = screen.getAllByText('Sensor (control)');
		// pick the one that belongs to a role=option element (the dropdown's row)
		const controlOption = matching.find((el) => el.closest('[role="option"]'))!;
		expect(controlOption).toBeTruthy();

		// Find the CheckIcon in the control option row - check its option container
		const controlItem = controlOption.closest('[role="option"]')! as HTMLElement;
		expect(controlItem.querySelector('.opacity-100')).toBeTruthy();

		// Click the other option and ensure onSelect receives that exact option (toolboard)
		const toolMatches = screen.getAllByText('Sensor (toolboard)');
		const toolOption = toolMatches.find((el) => el.closest('[role="option"]'))!;
		expect(toolOption).toBeTruthy();

		fireEvent.click(toolOption);

		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(onSelect).toHaveBeenCalledWith(options[1]);
	});
});
