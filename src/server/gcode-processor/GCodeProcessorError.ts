export abstract class GCodeProcessorError extends Error {}

/** Indicates an error with the logic of the G-code processor, such as an unexpected state. */
export class InternalError extends GCodeProcessorError {}
