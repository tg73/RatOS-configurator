import { NonUndefined } from '@/server/gcode-processor/constraints';

/**
 * Represents a value which may not be known until later. Once set, the value cannot be changed.
 */
export class Deferred<T> {
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
