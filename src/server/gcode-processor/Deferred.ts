/**
 * @file Deferred.ts
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
