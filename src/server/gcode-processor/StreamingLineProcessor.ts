/*
https://www.paigeniedringhaus.com/blog/streams-for-the-win-a-performance-comparison-of-node-js-methods-for-reading-large-datasets-pt-2

The above article compares fs.readFile(), fs.createReadStream() & rl.readLine(), and event-stream.
It concludes that only event-stream can handle multi-gb files. event-stream was also the winner for performance.

*/

/*
import { existsSync } from 'fs';

export interface LineProvider {
	getNextLine(): string | null;
}



export default class StreamingLineProcessor {
	constructor(parameters) {
		
	}
}
*/