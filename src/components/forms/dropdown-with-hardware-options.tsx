import React from 'react';
import { useRecoilValue, RecoilValueReadOnly } from 'recoil';
import { Dropdown, DropdownProps } from '@/components/forms/dropdown';
import { ToolOrAxis } from '@/zods/toolhead';

type Option = {
	id: number | string;
	connectedTo?: string;
	title: string;
	disabled?: boolean;
	badge?: any;
};

export interface DropdownWithHardwareOptionsProps<
	DropdownOption extends Option = Option,
	CanClear extends boolean = false,
> extends Omit<DropdownProps<DropdownOption, CanClear>, 'options' | 'onShown' | 'isFetching'> {
	selector: RecoilValueReadOnly<DropdownOption[]>;
	toolOrAxis?: ToolOrAxis;
}

export const DropdownWithHardwareOptions = <DropdownOption extends Option = Option, CanClear extends boolean = false>(
	props: DropdownWithHardwareOptionsProps<DropdownOption, CanClear>,
) => {
	const { selector, toolOrAxis, ...rest } = props;
	const { value } = rest as unknown as { value: Option; onSelect: (option: Option) => void };

	// Use the selector directly - it will handle all the logic internally
	const options = useRecoilValue(selector) as DropdownOption[];

	// Find the selected option in the current options to refresh badge/title if needed
	const selectedOption = options.find((o) => {
		return o.id === value?.id && o.connectedTo === value?.connectedTo;
	});
	const correctedValue = selectedOption ?? value;

	return (
		<React.Suspense fallback={<Dropdown {...rest} options={[]} isFetching={true} value={value as DropdownOption} />}>
			<Dropdown {...rest} options={options} value={correctedValue as DropdownOption} />
		</React.Suspense>
	);
};
