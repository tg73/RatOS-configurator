/**
 * Safely extracts a meaningful string message from an unknown exception type.
 * Ensures the code is safe even if the thrown value is not an Error object.
 * * @param error The unknown value caught in a try/catch block.
 * @returns A string representing the error message.
 */
export function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		// 1. If it's a standard Error object (recommended way to throw)
		return error.message;
	}

	if (typeof error === 'string') {
		// 2. If someone threw a simple string
		return error;
	}

	if (error && typeof error === 'object' && 'message' in error) {
		// 3. If it's a custom object with a 'message' property (e.g., { message: 'Failed' })
		// We cast the message property to unknown first, then to string for safety.
		const message = (error as { message: unknown }).message;
		if (typeof message === 'string') {
			return message;
		}
	}

	// 4. Fallback for everything else (e.g., numbers, symbols, objects without a message field)
	return 'An unknown error occurred.';
}
